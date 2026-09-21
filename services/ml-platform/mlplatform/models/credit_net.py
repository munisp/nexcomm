"""
CreditNet — MLP with two heads:
  - credit score regression head (scaled to 300–900)
  - default-probability head (sigmoid)

forward(x: FloatTensor (B,F)) -> (score FloatTensor (B,), default_prob FloatTensor (B,))

Closes audit A3 gap: credit scoring was an explicitly hand-coded heuristic
scorecard; this learns from realised behaviour while keeping the same
300–900 output contract the Rust service exposes.
"""
from __future__ import annotations

import torch
from torch import nn

SCORE_MIN, SCORE_MAX = 300.0, 900.0


class CreditNet(nn.Module):
    def __init__(self, num_features: int, hidden: tuple[int, ...] = (64, 32), dropout: float = 0.1):
        super().__init__()
        self.num_features = num_features
        layers: list[nn.Module] = []
        prev = num_features
        for h in hidden:
            layers += [nn.Linear(prev, h), nn.ReLU(), nn.Dropout(dropout)]
            prev = h
        self.backbone = nn.Sequential(*layers)
        self.score_head = nn.Linear(prev, 1)
        self.default_head = nn.Linear(prev, 1)

    def forward(self, x: torch.FloatTensor) -> tuple[torch.FloatTensor, torch.FloatTensor]:
        h = self.backbone(x)
        score = torch.sigmoid(self.score_head(h)).squeeze(-1) * (SCORE_MAX - SCORE_MIN) + SCORE_MIN
        default_prob = torch.sigmoid(self.default_head(h)).squeeze(-1)
        return score, default_prob

    def config(self) -> dict:
        return {"num_features": self.num_features}
