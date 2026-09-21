"""
PriceLSTM — real 2-layer LSTM + additive attention + linear head.

forward(seq: FloatTensor (B,T,F)) -> (mean, std): parameters of the next-day
log-return distribution (Gaussian NLL training target).

Closes audit A3 gap: the repo's "LSTM" was hand-rolled numpy where the inner
weights were never updated and the forecast was a Monte Carlo random walk.
"""
from __future__ import annotations

import torch
from torch import nn


class AdditiveAttention(nn.Module):
    """Bahdanau-style additive attention over LSTM hidden states."""

    def __init__(self, hidden: int):
        super().__init__()
        self.w = nn.Linear(hidden, hidden)
        self.v = nn.Linear(hidden, 1, bias=False)

    def forward(self, h: torch.Tensor) -> torch.Tensor:
        # h: (B, T, H) -> context (B, H)
        scores = self.v(torch.tanh(self.w(h))).squeeze(-1)  # (B, T)
        weights = torch.softmax(scores, dim=1).unsqueeze(-1)  # (B, T, 1)
        return (weights * h).sum(dim=1)


class PriceLSTM(nn.Module):
    def __init__(self, input_dim: int, hidden: int = 32, num_layers: int = 2,
                 dropout: float = 0.1):
        super().__init__()
        self.input_dim = input_dim
        self.hidden = hidden
        self.num_layers = num_layers
        self.lstm = nn.LSTM(
            input_size=input_dim, hidden_size=hidden, num_layers=num_layers,
            batch_first=True, dropout=dropout if num_layers > 1 else 0.0,
        )
        self.attention = AdditiveAttention(hidden)
        self.mean_head = nn.Linear(hidden, 1)
        self.std_head = nn.Linear(hidden, 1)

    def forward(self, seq: torch.FloatTensor) -> tuple[torch.Tensor, torch.Tensor]:
        out, _ = self.lstm(seq)          # (B, T, H)
        ctx = self.attention(out)        # (B, H)
        mean = self.mean_head(ctx).squeeze(-1)
        std = torch.nn.functional.softplus(self.std_head(ctx)).squeeze(-1) + 1e-4
        return mean, std

    def config(self) -> dict:
        return {"input_dim": self.input_dim, "hidden": self.hidden,
                "num_layers": self.num_layers}
