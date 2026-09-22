"""
Neo4j export for the heterogeneous transaction graph.

Two real modes:
  1. Bulk export: writes nodes.csv / edges.csv in neo4j-admin import format
     plus a LOAD Cypher script for Neo4j Browser / cypher-shell.
  2. Live load: when the `neo4j` driver is importable AND NEO4J_URI is set,
     MERGE-loads nodes and edges in batches over Bolt.

Closes audit A3 gap: zero Neo4j presence anywhere in the repo ("graph" claims
were fabricated strings).
"""
from __future__ import annotations

import csv
import logging
from pathlib import Path

logger = logging.getLogger("mlplatform.graph.neo4j_exporter")

try:
    from neo4j import GraphDatabase  # type: ignore

    _HAS_NEO4J = True
except ImportError:  # optional dependency
    GraphDatabase = None
    _HAS_NEO4J = False

_LABEL_BY_TYPE = {"account": "Account", "device": "Device", "ip": "Ip", "receipt": "WarehouseReceipt"}

LOAD_CYPHER = """// NEXCOM transaction graph — bulk load (run in Neo4j Browser or cypher-shell)
CREATE CONSTRAINT account_id IF NOT EXISTS FOR (a:Account) REQUIRE a.id IS UNIQUE;
CREATE CONSTRAINT device_id  IF NOT EXISTS FOR (d:Device)  REQUIRE d.id IS UNIQUE;
CREATE CONSTRAINT ip_id      IF NOT EXISTS FOR (i:Ip)      REQUIRE i.id IS UNIQUE;
CREATE CONSTRAINT receipt_id IF NOT EXISTS FOR (r:WarehouseReceipt) REQUIRE r.id IS UNIQUE;

LOAD CSV WITH HEADERS FROM 'file:///nodes.csv' AS row
CALL {
  WITH row
  MERGE (n {id: row.id})
  SET n:Account, n.node_type = row.node_type
  WITH n, row WHERE row.node_type = 'device'
  REMOVE n:Account SET n:Device
} IN TRANSACTIONS OF 10000 ROWS;

LOAD CSV WITH HEADERS FROM 'file:///edges.csv' AS row
MATCH (s {id: row.start_id}), (d {id: row.end_id})
CALL {
  WITH s, d, row
  MERGE (s)-[e:TRANSACTS]->(d)
  SET e.weight = toFloat(row.weight), e.edge_type = row.edge_type
} IN TRANSACTIONS OF 10000 ROWS;
"""


def export_csv(node_index, edges, out_dir: str | Path) -> dict[str, str]:
    """Write neo4j-admin/bulk-import compatible CSVs and the LOAD script."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    nodes_path = out_dir / "nodes.csv"
    with open(nodes_path, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["id:ID", "node_type", ":LABEL"])
        for row in node_index.itertuples():
            label = _LABEL_BY_TYPE.get(row.node_type, "Node")
            writer.writerow([row.node_id, row.node_type, label])

    edges_path = out_dir / "edges.csv"
    idx_to_id = dict(zip(node_index["idx"], node_index["node_id"]))
    with open(edges_path, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow([":START_ID", ":END_ID", ":TYPE", "weight:double"])
        for row in edges.itertuples():
            writer.writerow([idx_to_id[row.src_idx], idx_to_id[row.dst_idx],
                             row.edge_type, f"{row.weight:.2f}"])

    cypher_path = out_dir / "load.cypher"
    cypher_path.write_text(LOAD_CYPHER)
    logger.info("neo4j bulk export written to %s (%d nodes, %d edges)",
                out_dir, len(node_index), len(edges))
    return {"nodes": str(nodes_path), "edges": str(edges_path), "cypher": str(cypher_path)}


def live_load(node_index, edges, uri: str, user: str = "neo4j",
              password: str | None = None, batch_size: int = 5000) -> dict[str, int]:
    """MERGE-load nodes/edges into a live Neo4j over Bolt (driver-guarded)."""
    if not _HAS_NEO4J:
        raise ImportError("neo4j driver not importable; use export_csv bulk path")
    driver = GraphDatabase.driver(uri, auth=(user, password or ""))
    n_nodes = n_edges = 0
    try:
        with driver.session() as session:
            for label in set(_LABEL_BY_TYPE.values()):
                session.run(
                    f"CREATE CONSTRAINT IF NOT EXISTS FOR (n:{label}) REQUIRE n.id IS UNIQUE"
                )
            node_rows = [
                {"id": r.node_id, "type": r.node_type,
                 "label": _LABEL_BY_TYPE.get(r.node_type, "Node")}
                for r in node_index.itertuples()
            ]
            for i in range(0, len(node_rows), batch_size):
                batch = node_rows[i:i + batch_size]
                session.run(
                    "UNWIND $rows AS row "
                    "CALL { WITH row MERGE (n:Node {id: row.id}) SET n.node_type = row.type } "
                    "IN TRANSACTIONS",
                    rows=batch,
                )
                n_nodes += len(batch)
            idx_to_id = dict(zip(node_index["idx"], node_index["node_id"]))
            edge_rows = [
                {"s": idx_to_id[e.src_idx], "d": idx_to_id[e.dst_idx],
                 "t": e.edge_type, "w": float(e.weight)}
                for e in edges.itertuples()
            ]
            for i in range(0, len(edge_rows), batch_size):
                batch = edge_rows[i:i + batch_size]
                session.run(
                    "UNWIND $rows AS row "
                    "MATCH (s:Node {id: row.s}), (d:Node {id: row.d}) "
                    "MERGE (s)-[e:LINK {edge_type: row.t}]->(d) SET e.weight = row.w",
                    rows=batch,
                )
                n_edges += len(batch)
    finally:
        driver.close()
    logger.info("live-loaded %d nodes, %d edges into %s", n_nodes, n_edges, uri)
    return {"nodes": n_nodes, "edges": n_edges}


def export_graph(graph: dict, out_dir: str | Path,
                 neo4j_uri: str | None = None, neo4j_user: str = "neo4j",
                 neo4j_password: str | None = None) -> dict:
    """Bulk-export always; live-load additionally when driver+URI available."""
    result = export_csv(graph["node_index"], graph["edges"], out_dir)
    if neo4j_uri and _HAS_NEO4J:
        result["live"] = live_load(graph["node_index"], graph["edges"],
                                   neo4j_uri, neo4j_user, neo4j_password)
    elif neo4j_uri:
        logger.warning("NEO4J_URI set but neo4j driver not importable; bulk CSVs only")
    return result


def main(argv: list[str] | None = None) -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Export graph to Neo4j")
    parser.add_argument("--base-path", "--lakehouse-path", "--data-dir", dest="base_path", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--neo4j-uri", default=None)
    parser.add_argument("--neo4j-user", default="neo4j")
    parser.add_argument("--neo4j-password", default=None)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    from mlplatform.graph.builder import build_graph

    graph = build_graph(args.base_path)
    res = export_graph(graph, args.out_dir, args.neo4j_uri, args.neo4j_user, args.neo4j_password)
    print(res)


if __name__ == "__main__":
    main()
