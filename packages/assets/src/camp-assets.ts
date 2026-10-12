import type { AssetDefinitionInput } from './schema';

// Permanent numeric IDs; do not reorder when adding assets.
export const CAMP_ASSET = {
  "barbed-wire-fence": 2000,
  "military-lamp-post": 2001,
  "military-wooden-crate": 2002,
  "rusty-oil-barrel": 2003,
  "zion-ammo-cache-station": 2004,
  "branch-stick": 2005,
  "car-battery": 2006,
  "field-tent": 2007,
  "iron-fence": 2008,
  "large-stone-brick-wall": 2009,
  "lon-cu-nat": 2010,
  "old-carton-box": 2011,
  "old-dusty-wood-board": 2012,
  "old-iron-bucket": 2013,
  "old-solar-panel": 2014,
  "old-water-pipe": 2015,
  "old-wooden-beam": 2016,
  "old-wooden-crate": 2017,
  "perforated-corrugated-sheet": 2018,
  "rusted-wire-coil": 2019,
  "rusty-corrugated-sheet": 2020,
  "rusty-iron-bar": 2021,
  "rusty-iron-wall-ladder": 2022,
  "rusty-metal-plate": 2023,
  "sandbag-wall": 2024,
  "small-transformer": 2025,
  "utility-pole": 2026,
  "water-bottle": 2027,
  "wooden-fence": 2028,
  "medical-table": 2029,
  "weapon-table": 2030,
  "broken-concrete-wall": 2031,
  "broken-glass-pane": 2032,
  "concrete-wall-panel": 2033,
  "concrete-wall": 2034,
  "glass-pane": 2035,
  "mossy-concrete-wall": 2036,
  "shattered-glass-pane": 2037,
  "old-rusty-tank": 2038,
  "rusty-old-helicopter": 2039,
  "straight-lamp-post": 2040,
  "l-shaped-kitchen-counter": 2041
} as const;

export const CAMP_ASSETS: readonly AssetDefinitionInput[] = [
  {
    "id": "camp.barbed_wire_fence",
    "numericId": 2000,
    "name": "barbed wire fence",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "dists/barbed-wire-fence.bbmodel",
      "unitsPerMeter": 8,
      "offset": [
        0,
        0,
        -0.0625
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          1.6875,
          0
        ],
        "halfExtents": [
          2,
          1.6875,
          0.3125
        ]
      }
    ],
    "bounds": {
      "radius": 2.0242668425877057,
      "height": 3.375
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "dists",
      "contact-damage"
    ]
  },
  {
    "id": "camp.military_lamp_post",
    "numericId": 2001,
    "name": "military lamp post",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "dists/military-lamp-post.bbmodel",
      "unitsPerMeter": 4,
      "offset": [
        -2,
        0,
        -2
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          0.5,
          0
        ],
        "halfExtents": [
          1.25,
          0.5,
          1.25
        ]
      },
      {
        "type": "box",
        "center": [
          0,
          1.875,
          0
        ],
        "halfExtents": [
          0.25,
          0.875,
          0.25
        ]
      }
    ],
    "bounds": {
      "radius": 1.7677669529663689,
      "height": 4
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "dists"
    ]
  },
  {
    "id": "camp.military_wooden_crate",
    "numericId": 2002,
    "name": "military wooden crate",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "dists/military-wooden-crate.bbmodel",
      "unitsPerMeter": 16,
      "offset": [
        0,
        0,
        0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          0.375,
          0
        ],
        "halfExtents": [
          0.5,
          0.375,
          0.375
        ]
      }
    ],
    "bounds": {
      "radius": 0.625,
      "height": 0.75
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "dists"
    ]
  },
  {
    "id": "camp.rusty_oil_barrel",
    "numericId": 2003,
    "name": "rusty oil barrel",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "dists/rusty-oil-barrel.bbmodel",
      "unitsPerMeter": 16,
      "offset": [
        -0.0625,
        0,
        0.0625
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          0.46875,
          0
        ],
        "halfExtents": [
          0.5,
          0.46875,
          0.375
        ]
      }
    ],
    "bounds": {
      "radius": 0.625,
      "height": 0.9375
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "dists"
    ]
  },
  {
    "id": "camp.zion_ammo_cache_station",
    "numericId": 2004,
    "name": "zion ammo cache station",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "dists/zion-ammo-cache-station.bbmodel",
      "unitsPerMeter": 16,
      "offset": [
        -0.15625,
        0.016176190318907546,
        0.109375
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          0.8756343696601874,
          0
        ],
        "halfExtents": [
          1.96875,
          0.8756343696601874,
          1.140625
        ]
      }
    ],
    "bounds": {
      "radius": 2.2753026069349542,
      "height": 1.7512687393203747
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "dists"
    ]
  },
  {
    "id": "camp.branch_stick",
    "numericId": 2005,
    "name": "branch stick",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/branch-stick.bbmodel",
      "unitsPerMeter": 16,
      "offset": [
        -0.10751356896403902,
        0.0625,
        0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          1.28125,
          0
        ],
        "halfExtents": [
          0.482513568964039,
          1.28125,
          0.125
        ]
      }
    ],
    "bounds": {
      "radius": 0.49844191661056597,
      "height": 2.5625
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.car_battery",
    "numericId": 2006,
    "name": "car battery",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/car-battery.bbmodel",
      "unitsPerMeter": 16,
      "offset": [
        0,
        0,
        0.03125
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          0.46875,
          0
        ],
        "halfExtents": [
          0.4375,
          0.46875,
          0.28125
        ]
      }
    ],
    "bounds": {
      "radius": 0.5201036555341637,
      "height": 0.9375
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.field_tent",
    "numericId": 2007,
    "name": "field tent",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/field-tent.bbmodel",
      "unitsPerMeter": 4,
      "offset": [
        -2.0669872981077804,
        0,
        -2
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          -1.4419872981077804,
          0.625,
          -1.875
        ],
        "halfExtents": [
          1.375,
          0.625,
          0.125
        ]
      },
      {
        "type": "box",
        "center": [
          1.3080127018922196,
          0.625,
          -1.875
        ],
        "halfExtents": [
          1.375,
          0.625,
          0.125
        ]
      },
      {
        "type": "box",
        "center": [
          -1.4419872981077804,
          0.625,
          1.875
        ],
        "halfExtents": [
          1.375,
          0.625,
          0.125
        ]
      },
      {
        "type": "box",
        "center": [
          1.3080127018922196,
          0.625,
          1.875
        ],
        "halfExtents": [
          1.375,
          0.625,
          0.125
        ]
      },
      {
        "type": "box",
        "center": [
          2.8080127018922196,
          0.75,
          -1.75
        ],
        "halfExtents": [
          0.125,
          0.75,
          0.25
        ]
      },
      {
        "type": "box",
        "center": [
          2.8080127018922196,
          1,
          -1.25
        ],
        "halfExtents": [
          0.125,
          1,
          0.25
        ]
      },
      {
        "type": "box",
        "center": [
          2.8080127018922196,
          1.25,
          -0.75
        ],
        "halfExtents": [
          0.125,
          1.25,
          0.25
        ]
      },
      {
        "type": "box",
        "center": [
          2.8080127018922196,
          1.5,
          -0.25
        ],
        "halfExtents": [
          0.125,
          1.5,
          0.25
        ]
      },
      {
        "type": "box",
        "center": [
          2.8080127018922196,
          1.5,
          0.25
        ],
        "halfExtents": [
          0.125,
          1.5,
          0.25
        ]
      },
      {
        "type": "box",
        "center": [
          2.8080127018922196,
          1.25,
          0.75
        ],
        "halfExtents": [
          0.125,
          1.25,
          0.25
        ]
      },
      {
        "type": "box",
        "center": [
          2.8080127018922196,
          1,
          1.25
        ],
        "halfExtents": [
          0.125,
          1,
          0.25
        ]
      },
      {
        "type": "box",
        "center": [
          2.8080127018922196,
          0.75,
          1.75
        ],
        "halfExtents": [
          0.125,
          0.75,
          0.25
        ]
      },
      {
        "type": "box",
        "center": [
          -2.9419872981077804,
          0.75,
          -1.75
        ],
        "halfExtents": [
          0.125,
          0.75,
          0.25
        ]
      },
      {
        "type": "box",
        "center": [
          -2.9419872981077804,
          1,
          -1.25
        ],
        "halfExtents": [
          0.125,
          1,
          0.25
        ]
      },
      {
        "type": "box",
        "center": [
          -2.9419872981077804,
          1.25,
          -0.75
        ],
        "halfExtents": [
          0.125,
          1.25,
          0.25
        ]
      },
      {
        "type": "box",
        "center": [
          -2.9419872981077804,
          1.25,
          0.75
        ],
        "halfExtents": [
          0.125,
          1.25,
          0.25
        ]
      },
      {
        "type": "box",
        "center": [
          -2.9419872981077804,
          1,
          1.25
        ],
        "halfExtents": [
          0.125,
          1,
          0.25
        ]
      },
      {
        "type": "box",
        "center": [
          -2.9419872981077804,
          0.75,
          1.75
        ],
        "halfExtents": [
          0.125,
          0.75,
          0.25
        ]
      },
      {
        "type": "box",
        "center": [
          -2.9419872981077804,
          2.625,
          0
        ],
        "halfExtents": [
          0.125,
          0.375,
          0.5
        ]
      },
      {
        "type": "box",
        "center": [
          -3.1919872981077804,
          1.25,
          -0.625
        ],
        "halfExtents": [
          0.125,
          1.25,
          0.125
        ]
      },
      {
        "type": "box",
        "center": [
          -3.1919872981077804,
          1.25,
          0.625
        ],
        "halfExtents": [
          0.125,
          1.25,
          0.125
        ]
      }
    ],
    "bounds": {
      "radius": 5.617837240806434,
      "height": 4
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.iron_fence",
    "numericId": 2008,
    "name": "iron fence",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/iron-fence.bbmodel",
      "unitsPerMeter": 8,
      "offset": [
        0,
        0,
        0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          1.25,
          0
        ],
        "halfExtents": [
          1.125,
          1.25,
          0.25
        ]
      }
    ],
    "bounds": {
      "radius": 1.152443057161611,
      "height": 2.5
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.large_stone_brick_wall",
    "numericId": 2009,
    "name": "large stone brick wall",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/large-stone-brick-wall.bbmodel",
      "unitsPerMeter": 8,
      "offset": [
        0,
        0,
        0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          1.125,
          0
        ],
        "halfExtents": [
          2,
          1.125,
          0.25
        ]
      }
    ],
    "bounds": {
      "radius": 2.0155644370746373,
      "height": 2.25
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.lon_cu_nat",
    "numericId": 2010,
    "name": "lon cu nat",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/lon-cu-nat.bbmodel",
      "unitsPerMeter": 65.93029645775782,
      "offset": [
        0.0,
        0.0,
        0.007583766900249794
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0.0,
          0.1,
          0.0
        ],
        "halfExtents": [
          0.06067013520199835,
          0.1,
          0.06825390210224815
        ]
      }
    ],
    "bounds": {
      "radius": 0.09132064639287236,
      "height": 0.2
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.old_carton_box",
    "numericId": 2011,
    "name": "old carton box",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/old-carton-box.bbmodel",
      "unitsPerMeter": 16,
      "offset": [
        -0.03125,
        0,
        -0.042878705721972804
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          0.3198991129338434,
          0
        ],
        "halfExtents": [
          0.46875,
          0.3198991129338434,
          0.41787870572197283
        ]
      }
    ],
    "bounds": {
      "radius": 0.6279722726330129,
      "height": 0.6397982258676868
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.old_dusty_wood_board",
    "numericId": 2012,
    "name": "old dusty wood board",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/old-dusty-wood-board.bbmodel",
      "unitsPerMeter": 16,
      "offset": [
        0,
        0,
        0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          0.78125,
          0
        ],
        "halfExtents": [
          0.75,
          0.78125,
          0.125
        ]
      }
    ],
    "bounds": {
      "radius": 0.7603453162872773,
      "height": 1.5625
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.old_iron_bucket",
    "numericId": 2013,
    "name": "old iron bucket",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/old-iron-bucket.bbmodel",
      "unitsPerMeter": 16,
      "offset": [
        0,
        0,
        0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          0.5625,
          0
        ],
        "halfExtents": [
          0.5,
          0.5625,
          0.4375
        ]
      }
    ],
    "bounds": {
      "radius": 0.6643841132959156,
      "height": 1.125
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.old_solar_panel",
    "numericId": 2014,
    "name": "old solar panel",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/old-solar-panel.bbmodel",
      "unitsPerMeter": 16,
      "offset": [
        0,
        0,
        0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          0.375,
          0
        ],
        "halfExtents": [
          0.5,
          0.375,
          0.375
        ]
      }
    ],
    "bounds": {
      "radius": 0.625,
      "height": 0.75
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.old_water_pipe",
    "numericId": 2015,
    "name": "old water pipe",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/old-water-pipe.bbmodel",
      "unitsPerMeter": 16,
      "offset": [
        -0.125,
        0,
        0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          0.53125,
          0
        ],
        "halfExtents": [
          0.875,
          0.53125,
          0.25
        ]
      }
    ],
    "bounds": {
      "radius": 0.9100137361600649,
      "height": 1.0625
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.old_wooden_beam",
    "numericId": 2016,
    "name": "old wooden beam",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/old-wooden-beam.bbmodel",
      "unitsPerMeter": 16,
      "offset": [
        -0.0625,
        0,
        -0.03125
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          0.1875,
          0
        ],
        "halfExtents": [
          1.4375,
          0.1875,
          0.21875
        ]
      }
    ],
    "bounds": {
      "radius": 1.4540487655164802,
      "height": 0.375
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.old_wooden_crate",
    "numericId": 2017,
    "name": "old wooden crate",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/old-wooden-crate.bbmodel",
      "unitsPerMeter": 16,
      "offset": [
        0,
        5.551115123125783e-17,
        0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          0.5,
          0
        ],
        "halfExtents": [
          0.5,
          0.5,
          0.5
        ]
      }
    ],
    "bounds": {
      "radius": 0.7071067811865476,
      "height": 1
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.perforated_corrugated_sheet",
    "numericId": 2018,
    "name": "perforated corrugated sheet",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/perforated-corrugated-sheet.bbmodel",
      "unitsPerMeter": 16,
      "offset": [
        0,
        0,
        0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          0.5,
          0
        ],
        "halfExtents": [
          0.5,
          0.5,
          0.1791265877365274
        ]
      }
    ],
    "bounds": {
      "radius": 0.531118004245885,
      "height": 1
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.rusted_wire_coil",
    "numericId": 2019,
    "name": "rusted wire coil",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/rusted-wire-coil.bbmodel",
      "unitsPerMeter": 16,
      "offset": [
        0,
        0,
        0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          0.03125,
          0
        ],
        "halfExtents": [
          0.5,
          0.03125,
          0.5
        ]
      }
    ],
    "bounds": {
      "radius": 0.7071067811865476,
      "height": 0.0625
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.rusty_corrugated_sheet",
    "numericId": 2020,
    "name": "rusty corrugated sheet",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/rusty-corrugated-sheet.bbmodel",
      "unitsPerMeter": 16,
      "offset": [
        0,
        0,
        0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          0.8066442366897906,
          0
        ],
        "halfExtents": [
          0.5,
          0.8066442366897906,
          0.125
        ]
      }
    ],
    "bounds": {
      "radius": 0.5153882032022076,
      "height": 1.6132884733795811
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.rusty_iron_bar",
    "numericId": 2021,
    "name": "rusty iron bar",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/rusty-iron-bar.bbmodel",
      "unitsPerMeter": 16,
      "offset": [
        0,
        0,
        0.03125
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          0.15625,
          0
        ],
        "halfExtents": [
          1,
          0.15625,
          0.15625
        ]
      }
    ],
    "bounds": {
      "radius": 1.0121334212938529,
      "height": 0.3125
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.rusty_iron_wall_ladder",
    "numericId": 2022,
    "name": "rusty iron wall ladder",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "dists/rusty-iron-wall-ladder.bbmodel",
      "unitsPerMeter": 16,
      "offset": [
        0,
        0,
        -0.4375
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          1,
          0
        ],
        "halfExtents": [
          0.4375,
          1,
          0.125
        ]
      }
    ],
    "bounds": {
      "radius": 0.45500686808003243,
      "height": 2
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.rusty_metal_plate",
    "numericId": 2023,
    "name": "rusty metal plate",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/rusty-metal-plate.bbmodel",
      "unitsPerMeter": 8,
      "offset": [
        0,
        0,
        0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          0.1875,
          0
        ],
        "halfExtents": [
          1,
          0.1875,
          1
        ]
      }
    ],
    "bounds": {
      "radius": 1.4142135623730951,
      "height": 0.375
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.sandbag_wall",
    "numericId": 2024,
    "name": "sandbag wall",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/sandbag-wall.bbmodel",
      "unitsPerMeter": 8,
      "offset": [
        0,
        0,
        0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          1,
          0
        ],
        "halfExtents": [
          1.125,
          1,
          0.4006540536544371
        ]
      }
    ],
    "bounds": {
      "radius": 1.1942146669295821,
      "height": 2
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.small_transformer",
    "numericId": 2025,
    "name": "small transformer",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/small-transformer.bbmodel",
      "unitsPerMeter": 16,
      "offset": [
        0,
        0,
        0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          0.5625,
          0
        ],
        "halfExtents": [
          0.5,
          0.5625,
          0.3125
        ]
      }
    ],
    "bounds": {
      "radius": 0.5896238207535377,
      "height": 1.125
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.utility_pole",
    "numericId": 2026,
    "name": "utility pole",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/utility-pole.bbmodel",
      "unitsPerMeter": 8,
      "offset": [
        0,
        0,
        0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          3,
          0
        ],
        "halfExtents": [
          1.5,
          3,
          0.5
        ]
      }
    ],
    "bounds": {
      "radius": 1.5811388300841898,
      "height": 6
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.water_bottle",
    "numericId": 2027,
    "name": "water bottle",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/water-bottle.bbmodel",
      "unitsPerMeter": 50.0,
      "offset": [
        -0.01638304088577984,
        0.0,
        0.013471528727020923
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0.0,
          0.16,
          0.0
        ],
        "halfExtents": [
          0.07638304088577984,
          0.16,
          0.05347152872702093
        ]
      }
    ],
    "bounds": {
      "radius": 0.09323933354203762,
      "height": 0.32
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.wooden_fence",
    "numericId": 2028,
    "name": "wooden fence",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/wooden-fence.bbmodel",
      "unitsPerMeter": 8,
      "offset": [
        0,
        0,
        0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          1.125,
          0
        ],
        "halfExtents": [
          2,
          1.125,
          0.25
        ]
      }
    ],
    "bounds": {
      "radius": 2.0155644370746373,
      "height": 2.25
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.medical_table",
    "numericId": 2029,
    "name": "medical table",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/medical-table.bbmodel",
      "unitsPerMeter": 14,
      "offset": [
        -0.0,
        0,
        -0.0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          0.5,
          0
        ],
        "halfExtents": [
          0.5,
          0.5,
          0.35714285714285715
        ]
      }
    ],
    "bounds": {
      "radius": 0.614451804788759,
      "height": 1.0
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.weapon_table",
    "numericId": 2030,
    "name": "weapon table",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/weapon-table.bbmodel",
      "unitsPerMeter": 16,
      "offset": [
        -0.0625,
        0,
        -0.0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          0.5,
          0
        ],
        "halfExtents": [
          0.8125,
          0.5,
          0.4375
        ]
      }
    ],
    "bounds": {
      "radius": 0.9228014412645875,
      "height": 1.0
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.broken_concrete_wall",
    "numericId": 2031,
    "name": "broken concrete wall",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/broken-concrete-wall.bbmodel",
      "unitsPerMeter": 8,
      "offset": [
        -0.0,
        0,
        0.0625
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          2.1875,
          0
        ],
        "halfExtents": [
          2.0,
          2.1875,
          0.5625
        ]
      }
    ],
    "bounds": {
      "radius": 2.0775962673243327,
      "height": 4.375
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.broken_glass_pane",
    "numericId": 2032,
    "name": "broken glass pane",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/broken-glass-pane.bbmodel",
      "unitsPerMeter": 8,
      "offset": [
        -0.0,
        0,
        -0.1875
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          1.0,
          0
        ],
        "halfExtents": [
          1.0,
          1.0,
          0.3125
        ]
      }
    ],
    "bounds": {
      "radius": 1.0476909133900132,
      "height": 2.0
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.concrete_wall_panel",
    "numericId": 2033,
    "name": "concrete wall panel",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/concrete-wall-panel.bbmodel",
      "unitsPerMeter": 10,
      "offset": [
        -0.0,
        0,
        -0.0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          1.75,
          0
        ],
        "halfExtents": [
          2.5,
          1.75,
          0.3
        ]
      }
    ],
    "bounds": {
      "radius": 2.5179356624028344,
      "height": 3.5
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.concrete_wall",
    "numericId": 2034,
    "name": "concrete wall",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/concrete-wall.bbmodel",
      "unitsPerMeter": 9.5,
      "offset": [
        -0.0,
        0,
        -0.0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          1.5789473684210527,
          0
        ],
        "halfExtents": [
          2.0,
          1.5789473684210527,
          0.42105263157894735
        ]
      }
    ],
    "bounds": {
      "radius": 2.0438408251523787,
      "height": 3.1578947368421053
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.glass_pane",
    "numericId": 2035,
    "name": "glass pane",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/glass-pane.bbmodel",
      "unitsPerMeter": 8,
      "offset": [
        -0.0,
        0,
        -0.0
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          1.0,
          0
        ],
        "halfExtents": [
          1.0,
          1.0,
          0.125
        ]
      }
    ],
    "bounds": {
      "radius": 1.0077822185373186,
      "height": 2.0
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.mossy_concrete_wall",
    "numericId": 2036,
    "name": "mossy concrete wall",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/mossy-concrete-wall.bbmodel",
      "unitsPerMeter": 8.5,
      "offset": [
        -0.0,
        0,
        0.11764705882352941
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          1.9411764705882353,
          0
        ],
        "halfExtents": [
          2.0,
          1.9411764705882353,
          0.47058823529411764
        ]
      }
    ],
    "bounds": {
      "radius": 2.0546175525379975,
      "height": 3.8823529411764706
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.shattered_glass_pane",
    "numericId": 2037,
    "name": "shattered glass pane",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/shattered-glass-pane.bbmodel",
      "unitsPerMeter": 8,
      "offset": [
        -0.0,
        0,
        -0.0
      ]
    },
    "colliders": [],
    "bounds": {
      "radius": 1.118033988749895,
      "height": 1.875
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  },
  {
    "id": "camp.old_rusty_tank",
    "numericId": 2038,
    "name": "old rusty tank",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "dists/old-rusty-tank.bbmodel",
      "unitsPerMeter": 4,
      "axisScale": [1.05, 0.9, 1.44],
      "offset": [
        -0.0,
        0,
        1.62
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          1.8,
          0
        ],
        "halfExtents": [
          2.1,
          1.8,
          4.5
        ]
      }
    ],
    "bounds": {
      "radius": 4.965884,
      "height": 3.6
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "dists"
    ]
  },
  {
    "id": "camp.rusty_old_helicopter",
    "numericId": 2039,
    "name": "rusty old helicopter",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "dists/rusty-old-helicopter.bbmodel",
      "unitsPerMeter": 3,
      "offset": [
        -0.0,
        0,
        -1.75
      ]
    },
    "colliders": [
      {
        "type": "box",
        "center": [
          0,
          3.0,
          0
        ],
        "halfExtents": [
          4.666666666666667,
          3.0,
          4.75
        ]
      }
    ],
    "bounds": {
      "radius": 6.658849583657659,
      "height": 6.0
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "dists"
    ]
  },
  {
    "id": "camp.straight_lamp_post",
    "numericId": 2040,
    "name": "straight lamp post",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "dists/straight-lamp-post.bbmodel",
      "unitsPerMeter": 12,
      "offset": [0, 0, 0]
    },
    "colliders": [
      { "type": "box", "center": [0, 0.17, 0], "halfExtents": [0.34, 0.17, 0.34] },
      { "type": "box", "center": [0, 2, 0], "halfExtents": [0.12, 2, 0.12] }
    ],
    "bounds": {
      "radius": 0.5,
      "height": 4.1
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "dists"
    ]
  },
  {
    "id": "camp.l_shaped_kitchen_counter",
    "numericId": 2041,
    "name": "l shaped kitchen counter",
    "category": "block",
    "model": {
      "kind": "bbmodel",
      "path": "materias/l-shaped-kitchen-counter.bbmodel",
      "unitsPerMeter": 16,
      "offset": [0, 0, 0]
    },
    "colliders": [
      { "type": "box", "center": [0, 0.47, 0.1875], "halfExtents": [1.0625, 0.47, 0.375] },
      { "type": "box", "center": [0.6875, 0.47, -0.6875], "halfExtents": [0.375, 0.47, 0.5] }
    ],
    "bounds": {
      "radius": 1.6,
      "height": 1.4
    },
    "render": {
      "maxDistance": 360
    },
    "tags": [
      "materias"
    ]
  }
];
