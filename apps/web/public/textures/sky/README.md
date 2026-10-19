# Sky panoramas

Both are equirectangular, tone-mapped JPG panoramas from Poly Haven (CC0 1.0, https://polyhaven.com/license), resized to 3072 × 1536 (JPEG quality 80):

- `day-sky-2.jpg`: **Kloofendal 48d Partly Cloudy (Pure Sky)**, https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky
- `night-sky.jpg`: **Satara Night (No Lamps)**, https://polyhaven.com/a/satara_night_no_lamps (only the sky above the horizon is shown)

The game loads the local files without contacting an external service. The sky shader blends day into night, tints them for dawn and dusk, and draws the sun, the moon and the animated clouds over them.
