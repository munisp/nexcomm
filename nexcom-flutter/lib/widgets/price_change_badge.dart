import 'package:flutter/material.dart';
import '../theme.dart';

class PriceChangeBadge extends StatelessWidget {
  final double changePct;
  final bool showIcon;

  const PriceChangeBadge({super.key, required this.changePct, this.showIcon = true});

  @override
  Widget build(BuildContext context) {
    final isPositive = changePct >= 0;
    final color = isPositive ? NexcomTheme.positive : NexcomTheme.negative;
    final sign = isPositive ? '+' : '';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (showIcon) Icon(
            isPositive ? Icons.arrow_upward : Icons.arrow_downward,
            color: color,
            size: 10,
          ),
          if (showIcon) const SizedBox(width: 2),
          Text(
            '$sign${changePct.toStringAsFixed(2)}%',
            style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}
