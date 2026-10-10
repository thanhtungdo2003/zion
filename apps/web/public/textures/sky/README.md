# Sky panorama

`day-sky.webp` is a 2048 × 1024 tone-mapped conversion of **Kloppenheim 06 (Pure Sky)** from Poly Haven.

- Source: https://polyhaven.com/a/kloppenheim_06_puresky
- Original: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloppenheim_06_puresky_2k.hdr
- License: CC0 1.0, https://polyhaven.com/license
- Conversion: RGBE to linear RGB, Reinhard `x / (1 + x)`, sRGB encoding, WebP quality 90.

The game loads the local WebP without contacting an external service. Animated cloud density and day/night tint are applied by the sky shader.
