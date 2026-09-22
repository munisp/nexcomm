"""
Pure-torch GraphSAGE (NO torch_geometric — not installable in the validation
environment).

SAGEConv implements the mean aggregator with index_add_ scatter:
    h_N(v) = mean({h_u : u in N(v)})     via index_add_ over edge dst
    h_v'   = W_self h_v + W_neigh h_N(v)

GraphSAGEClassifier(num_features, hidden=64, layers=2) -> node logits (N, C).

Closes audit A3 gap: the repo's "GNN" was rng.normal embeddings labelled
"GNN-style GraphSAGE" in anomaly.py.
"""
from __future__ import annotations

import torch
from torch import nn


class SAGEConv(nn.Module):
    """GraphSAGE mean-aggregator convolution using index_add_ scatter."""

    def __init__(self, in_dim: int, out_dim: int):
        super().__init__()
        self.self_lin = nn.Linear(in_dim, out_dim)
        self.neigh_lin = nn.Linear(in_dim, out_dim)

    def forward(self, x: torch.Tensor, edge_index: torch.LongTensor) -> torch.Tensor:
        src, dst = edge_index[0], edge_index[1]
        n = x.size(0)
        agg = torch.zeros_like(x)
        agg.index_add_(0, dst, x[src])
        deg = torch.zeros(n, dtype=x.dtype, device=x.device)
        deg.index_add_(0, dst, torch.ones(dst.size(0), dtype=x.dtype, device=x.device))
        agg = agg / deg.clamp(min=1.0).unsqueeze(-1)
        return self.self_lin(x) + self.neigh_lin(agg)


class GraphSAGEClassifier(nn.Module):
    def __init__(self, num_features: int, hidden: int = 64, layers: int = 2,
                 num_classes: int = 2, dropout: float = 0.1):
        super().__init__()
        self.num_features = num_features
        self.hidden = hidden
        self.layers_n = layers
        self.num_classes = num_classes
        dims = [num_features] + [hidden] * max(0, layers - 1)
        self.convs = nn.ModuleList([SAGEConv(dims[i], hidden) for i in range(len(dims))])
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(hidden, num_classes)

    def forward(self, x: torch.Tensor, edge_index: torch.LongTensor) -> torch.Tensor:
        h = x
        for conv in self.convs:
            h = torch.relu(conv(h, edge_index))
            h = self.dropout(h)
        return self.head(h)  # logits (N, C)

    def config(self) -> dict:
        return {"num_features": self.num_features, "hidden": self.hidden,
                "layers": self.layers_n, "num_classes": self.num_classes}
