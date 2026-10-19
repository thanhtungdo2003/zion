# Sky panoramas

Both are equirectangular, tone-mapped JPG panoramas from Poly Haven (CC0 1.0, https://polyhaven.com/license):

- `day-sky-2.jpg`: **Kloofendal 48d Partly Cloudy (Pure Sky)**, https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky (3072 × 1536, quality 80)
- `night-sky-2.jpg`: **Qwantani Night (Pure Sky)**, https://polyhaven.com/a/qwantani_night_puresky, from the 8K tone-mapped JPG: 4096 × 2048, haze lifted (black point 16 %, gamma 1.25), the horizon glow faded into deep night blue, light unsharp mask (quality 90). No trees or land on the horizon.

The game loads the local files without contacting an external service. The sky shader blends day into night, tints them for dawn and dusk, and draws the sun, the moon and the animated clouds over them.
