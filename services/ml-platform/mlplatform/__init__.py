"""
mlplatform — the real PyTorch ML core for the NEXCOM commodity exchange.

Closes audit A3 findings: replaces numpy-fake "LSTM", random-noise "GNN",
synthetic sklearn seeding and pickle-at-/tmp "registry" with a real
lakehouse → features → training → registry stack.
"""

__version__ = "0.1.0"
