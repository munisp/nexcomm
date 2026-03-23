import 'package:flutter/material.dart';

class NexcomTheme {
  // Brand colors matching the web PWA
  static const Color primary = Color(0xFF10B981);       // Emerald green
  static const Color primaryDark = Color(0xFF059669);
  static const Color secondary = Color(0xFF3B82F6);     // Blue
  static const Color accent = Color(0xFFF59E0B);        // Amber
  static const Color negative = Color(0xFFEF4444);      // Red
  static const Color positive = Color(0xFF10B981);      // Green

  // Dark theme surfaces
  static const Color darkBg = Color(0xFF0A0F1E);
  static const Color darkSurface = Color(0xFF111827);
  static const Color darkCard = Color(0xFF1F2937);
  static const Color darkBorder = Color(0xFF374151);

  // Light theme surfaces
  static const Color lightBg = Color(0xFFF9FAFB);
  static const Color lightSurface = Color(0xFFFFFFFF);
  static const Color lightCard = Color(0xFFF3F4F6);

  static ThemeData get dark => ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorScheme: const ColorScheme.dark(
      primary: primary,
      secondary: secondary,
      surface: darkSurface,
      error: negative,
      onPrimary: Colors.white,
      onSecondary: Colors.white,
      onSurface: Colors.white,
    ),
    scaffoldBackgroundColor: darkBg,
    cardColor: darkCard,
    fontFamily: 'Inter',
    appBarTheme: const AppBarTheme(
      backgroundColor: darkSurface,
      foregroundColor: Colors.white,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontFamily: 'Inter',
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: Colors.white,
      ),
    ),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: darkSurface,
      selectedItemColor: primary,
      unselectedItemColor: Color(0xFF6B7280),
      type: BottomNavigationBarType.fixed,
      elevation: 0,
    ),
    cardTheme: CardTheme(
      color: darkCard,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: darkBorder, width: 1),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: darkCard,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: darkBorder),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: darkBorder),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: primary, width: 2),
      ),
      labelStyle: const TextStyle(color: Color(0xFF9CA3AF)),
      hintStyle: const TextStyle(color: Color(0xFF6B7280)),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: primary,
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        textStyle: const TextStyle(
          fontFamily: 'Inter',
          fontSize: 14,
          fontWeight: FontWeight.w600,
        ),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: primary,
        textStyle: const TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.w500),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: darkCard,
      selectedColor: primary.withOpacity(0.2),
      labelStyle: const TextStyle(fontFamily: 'Inter', fontSize: 12),
      side: const BorderSide(color: darkBorder),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
    ),
    dividerTheme: const DividerThemeData(color: darkBorder, thickness: 1),
    textTheme: const TextTheme(
      displayLarge: TextStyle(color: Colors.white, fontFamily: 'Inter', fontWeight: FontWeight.w700),
      displayMedium: TextStyle(color: Colors.white, fontFamily: 'Inter', fontWeight: FontWeight.w700),
      headlineLarge: TextStyle(color: Colors.white, fontFamily: 'Inter', fontWeight: FontWeight.w600),
      headlineMedium: TextStyle(color: Colors.white, fontFamily: 'Inter', fontWeight: FontWeight.w600),
      titleLarge: TextStyle(color: Colors.white, fontFamily: 'Inter', fontWeight: FontWeight.w600),
      titleMedium: TextStyle(color: Colors.white, fontFamily: 'Inter', fontWeight: FontWeight.w500),
      bodyLarge: TextStyle(color: Color(0xFFD1D5DB), fontFamily: 'Inter'),
      bodyMedium: TextStyle(color: Color(0xFF9CA3AF), fontFamily: 'Inter'),
      labelLarge: TextStyle(color: Colors.white, fontFamily: 'Inter', fontWeight: FontWeight.w500),
    ),
  );

  static ThemeData get light => ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    colorScheme: const ColorScheme.light(
      primary: primary,
      secondary: secondary,
      surface: lightSurface,
      error: negative,
    ),
    scaffoldBackgroundColor: lightBg,
    fontFamily: 'Inter',
    appBarTheme: const AppBarTheme(
      backgroundColor: lightSurface,
      foregroundColor: Color(0xFF111827),
      elevation: 0,
      centerTitle: false,
    ),
    cardTheme: CardTheme(
      color: lightSurface,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: Color(0xFFE5E7EB)),
      ),
    ),
  );
}
