"""
FraudNet — categorical embeddings + MLP over numerics → sigmoid fraud prob.

forward(x_cat: LongTensor (B,C), x_num: FloatTensor (B,N)) -> FloatTensor (B,)

Closes audit A3 gap: zero PyTorch anywhere in the repo's fraud stack.
"""
from __future__ import annotations

import torch
from torch import nn


class FraudNet(nn.Module):
    def __init__(
        self,
        cat_cardinalities: list[int],
        num_numeric: int,
        emb_dim: int = 8,
        hidden: tuple[int, ...] = (64, 32),
        dropout: float = 0.1,
    ):
        super().__init__()
        self.cat_cardinalities = list(cat_cardinalities)
        self.num_numeric = num_numeric
        self.embeddings = nn.ModuleList([
            nn.Embedding(card, min(emb_dim, max(2, card // 2))) for card in cat_cardinalities
        ])
        in_dim = sum(e.embedding_dim for e in self.embeddings) + num_numeric
        layers: list[nn.Module] = []
        prev = in_dim
        for h in hidden:
            layers += [nn.Linear(prev, h), nn.ReLU(), nn.Dropout(dropout)]
            prev = h
        layers.append(nn.Linear(prev, 1))
        self.mlp = nn.Sequential(*layers)

    def forward(self, x_cat: torch.LongTensor, x_num: torch.FloatTensor) -> torch.FloatTensor:
        embs = [emb(x_cat[:, i]) for i, emb in enumerate(self.embeddings)]
        x = torch.cat(embs + [x_num], dim=1)
        logit = self.mlp(x).squeeze(-1)
        return torch.sigmoid(logit)

    def config(self) -> dict:
        return {
            "cat_cardinalities": self.cat_cardinalities,
            "num_numeric": self.num_numeric,
            "hidden": [m.out_features for m in self.mlp if isinstance(m, nn.Linear)][:-1],
        }
