import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';
import '../theme.dart';

class LoadingShimmer extends StatelessWidget {
  final double height;
  final double? width;
  final double borderRadius;

  const LoadingShimmer({
    super.key,
    required this.height,
    this.width,
    this.borderRadius = 10,
  });

  @override
  Widget build(BuildContext context) {
    return Shimmer.fromColors(
      baseColor: NexcomTheme.darkCard,
      highlightColor: NexcomTheme.darkBorder,
      child: Container(
        height: height,
        width: width ?? double.infinity,
        decoration: BoxDecoration(
          color: NexcomTheme.darkCard,
          borderRadius: BorderRadius.circular(borderRadius),
        ),
      ),
    );
  }
}

class LoadingShimmerList extends StatelessWidget {
  final int count;
  final double itemHeight;

  const LoadingShimmerList({super.key, this.count = 5, this.itemHeight = 60});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: List.generate(count, (i) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: LoadingShimmer(height: itemHeight),
      )),
    );
  }
}
