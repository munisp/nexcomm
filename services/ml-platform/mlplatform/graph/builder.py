"""
Heterogeneous transaction graph builder.

Nodes: accounts (users), devices, IPs, warehouse receipts.
Edges: TRANSACTS (account→account, weight=NGN amount), USES_DEVICE,
       USES_IP, PLEDGES (account→receipt).

Uses networkx for analytics: degree centrality, clustering, and greedy
modularity community detection over the account↔account projection. Community
fraud density augments GNN labels: an account in a community whose labeled
members are majority-fraudulent is flagged as a probable ring member
(documented semi-supervised augmentation; GNN still trains on real features).

Outputs under gold/graph/: node_index, edges tables plus graph.npz
(node_features float32 (N,9), edge_index int64 (2,E), labels int64 (N,)
with -1 = unlabeled, train_mask bool).

Closes audit A3 gap: the repo's only "GNN" was random embeddings and a random
adjacency matrix; there was no graph data source at all.
"""
from __future__ import annotations

import logging
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd

from mlplatform.lakehouse.silver import read_silver
from mlplatform.lakehouse.storage import write_table

logger = logging.getLogger("mlplatform.graph.builder")

NODE_FEATURE_DIM = 9

EDGE_TRANSACTS = "TRANSACTS"
EDGE_USES_DEVICE = "USES_DEVICE"
EDGE_USES_IP = "USES_IP"
EDGE_PLEDGES = "PLEDGES"


def build_graph(base_path: str | Path, out_dir: str | Path | None = None,
                write: bool = True) -> dict:
    """Build the heterogeneous graph from silver tables.

    Returns dict with node_index (DataFrame), edges (DataFrame),
    node_features (np.ndarray), labels (np.ndarray), edge_index (np.ndarray),
    train_mask (np.ndarray).
    """
    base_path = Path(base_path)
    out_dir = Path(out_dir) if out_dir else base_path / "gold" / "graph"
    txns = read_silver(base_path, "transactions")
    labels_df = read_silver(base_path, "fraud_labels")
    if txns.empty:
        raise ValueError("no silver transactions; run bronze→silver first")

    txns = txns.copy()
    txns["amount_ngn"] = pd.to_numeric(txns["amount_ngn"], errors="coerce").fillna(0.0)
    txns["timestamp"] = pd.to_datetime(txns["timestamp"], utc=True, errors="coerce")

    accounts = sorted(set(txns["payer_id"].astype(str)) | set(txns["payee_id"].astype(str)))
    accounts = [a for a in accounts if a.startswith("U")]
    account_set = set(accounts)
    devices = sorted(txns["device_id"].astype(str).unique())
    ips = sorted(txns["ip_address"].astype(str).unique())
    receipts = sorted(r for r in txns["receipt_id"].astype(str).unique() if r)

    node_rows = (
        [("account", n) for n in accounts]
        + [("device", n) for n in devices]
        + [("ip", n) for n in ips]
        + [("receipt", n) for n in receipts]
    )
    node_index = pd.DataFrame(node_rows, columns=["node_type", "node_id"])
    node_index["idx"] = np.arange(len(node_index))
    idx_of = dict(zip(node_index["node_id"], node_index["idx"]))
    n_nodes = len(node_index)

    # ── Edges ────────────────────────────────────────────────────────────────
    edge_rows: list[tuple[int, int, str, float]] = []
    t_acct = txns[txns["payer_id"].isin(account_set) & txns["payee_id"].isin(account_set)]
    for payer, payee, amt in zip(t_acct["payer_id"], t_acct["payee_id"], t_acct["amount_ngn"]):
        edge_rows.append((idx_of[payer], idx_of[payee], EDGE_TRANSACTS, float(amt)))
    for uid, dev in zip(txns["payer_id"], txns["device_id"].astype(str)):
        if uid in account_set:
            edge_rows.append((idx_of[uid], idx_of[dev], EDGE_USES_DEVICE, 1.0))
            edge_rows.append((idx_of[dev], idx_of[uid], EDGE_USES_DEVICE, 1.0))
    for uid, ip in zip(txns["payer_id"], txns["ip_address"].astype(str)):
        if uid in account_set:
            edge_rows.append((idx_of[uid], idx_of[ip], EDGE_USES_IP, 1.0))
            edge_rows.append((idx_of[ip], idx_of[uid], EDGE_USES_IP, 1.0))
    pledged = txns[txns["receipt_id"].astype(str) != ""]
    for uid, rid in zip(pledged["payer_id"], pledged["receipt_id"].astype(str)):
        if uid in account_set:
            edge_rows.append((idx_of[uid], idx_of[rid], EDGE_PLEDGES, 1.0))
    edges = pd.DataFrame(edge_rows, columns=["src_idx", "dst_idx", "edge_type", "weight"])

    # ── Labels (account nodes; -1 = unlabeled) ───────────────────────────────
    labels = np.full(n_nodes, -1, dtype=np.int64)
    fraud_users: dict[str, set] = {}
    if not labels_df.empty:
        labels_df = labels_df.copy()
        labels_df["is_fraud"] = labels_df["is_fraud"].astype(str).str.lower().isin(["true", "1", "t"])
        fraud_only = labels_df[labels_df["is_fraud"]]
        for uid, ftype in zip(fraud_only["user_id"].astype(str), fraud_only["fraud_type"].astype(str)):
            fraud_users.setdefault(uid, set()).add(ftype)
    for uid in fraud_users:
        if uid in idx_of:
            labels[idx_of[uid]] = 1
    for uid in accounts:
        if labels[idx_of[uid]] == -1:
            labels[idx_of[uid]] = 0  # accounts without a fraud label are negatives

    # ── Community detection → label augmentation + features ──────────────────
    g_nx = nx.Graph()
    g_nx.add_nodes_from(range(len(accounts)))
    acct_pos = {uid: i for i, uid in enumerate(accounts)}
    for payer, payee in zip(t_acct["payer_id"], t_acct["payee_id"]):
        if payer != payee:
            g_nx.add_edge(acct_pos[payer], acct_pos[payee])
    community_id = np.zeros(n_nodes, dtype=np.int64)
    community_fraud_density = np.zeros(n_nodes, dtype=np.float64)
    if g_nx.number_of_edges() > 0:
        communities = list(nx.algorithms.community.greedy_modularity_communities(g_nx))
        for cid, members in enumerate(communities):
            member_nodes = [idx_of[accounts[m]] for m in members]
            member_labels = labels[member_nodes]
            labeled = member_labels[member_labels >= 0]
            density = float(labeled.mean()) if len(labeled) else 0.0
            for node_idx in member_nodes:
                community_id[node_idx] = cid
                community_fraud_density[node_idx] = density
                # Augmentation: majority-fraud community ⇒ probable ring member
                if len(labeled) >= 2 and density >= 0.5 and labels[node_idx] == 0:
                    labels[node_idx] = 1

    # ── Node features (N, 9) ──────────────────────────────────────────────────
    feats = np.zeros((n_nodes, NODE_FEATURE_DIM), dtype=np.float32)
    type_col = {"account": 0, "device": 1, "ip": 2, "receipt": 3}
    for row in node_index.itertuples():
        feats[row.idx, type_col[row.node_type]] = 1.0
    # degree + amount stats per account
    deg = np.zeros(n_nodes)
    amt = np.zeros(n_nodes)
    night = np.zeros(n_nodes)
    cancels = np.zeros(n_nodes)
    counts = np.zeros(n_nodes)
    for payer, payee, a in zip(t_acct["payer_id"], t_acct["payee_id"], t_acct["amount_ngn"]):
        deg[idx_of[payer]] += 1
        amt[idx_of[payer]] += a
    txn_hours = txns["timestamp"].dt.hour.fillna(12).astype(int)
    for uid, hour, status in zip(txns["payer_id"], txn_hours, txns["status"]):
        if uid in account_set:
            i = idx_of[uid]
            counts[i] += 1
            night[i] += 1.0 if int(hour) in (22, 23, 0, 1, 2, 3, 4) else 0.0
            cancels[i] += 1.0 if status == "CANCELLED" else 0.0
    feats[:, 4] = np.log1p(deg)
    feats[:, 5] = np.log1p(amt) / 20.0
    safe = np.maximum(counts, 1)
    feats[:, 6] = (night / safe).astype(np.float32)
    feats[:, 7] = (cancels / safe).astype(np.float32)
    feats[:, 8] = community_fraud_density.astype(np.float32)

    edge_index = edges[["src_idx", "dst_idx"]].to_numpy(dtype=np.int64).T
    train_mask = labels >= 0

    if write:
        out_dir.mkdir(parents=True, exist_ok=True)
        write_table(node_index, root=out_dir, table="node_index", partition_col=None)
        write_table(edges, root=out_dir, table="edges", partition_col=None)
        np.savez(
            out_dir / "graph.npz",
            node_features=feats.astype(np.float32),
            edge_index=edge_index.astype(np.int64),
            labels=labels.astype(np.int64),
            train_mask=train_mask,
        )
        logger.info("graph written to %s: %d nodes, %d edges, %d labeled fraud nodes",
                    out_dir, n_nodes, len(edges), int((labels == 1).sum()))

    return {
        "node_index": node_index,
        "edges": edges,
        "node_features": feats,
        "labels": labels,
        "edge_index": edge_index,
        "train_mask": train_mask,
        "community_id": community_id,
    }


def main(argv: list[str] | None = None) -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Build heterogeneous transaction graph")
    parser.add_argument("--base-path", "--lakehouse-path", "--data-dir", dest="base_path", required=True)
    parser.add_argument("--out-dir", default=None)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    g = build_graph(args.base_path, out_dir=args.out_dir)
    print(f"nodes={len(g['node_index'])} edges={len(g['edges'])} "
          f"fraud_nodes={int((g['labels'] == 1).sum())}")


if __name__ == "__main__":
    main()
