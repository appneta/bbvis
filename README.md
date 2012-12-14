# BBVis

BBVis is a Chrome extension that tracks event bindings between
Backbone views, models, and collections, and displays these connections in
a Developer Tools panel.  It's especially useful in understanding connections
between complex applications with many interdependent models and views.

BBVis was built specifically for use with TBone, but should work with regular
Backbone apps within the limitations below.

## TODO

- View render highlighting is not yet imported from pre-extension implementation.

## Limitations

- BBVis will not be able to understand connections between objects unless the
  context is specified in Backbone .on() calls.
- BBVis may not be able to detect all your models and views if they are
  created & bound in the same script as Backbone.  BBVis attempts to instrument
  Backbone after every script on a page loads.

## Acknowledgements

Includes a fantastic Dagre directed graph layout implementation by Chris Pettitt.

## License

Copyright (c) 2012 Dan Tillberg, AppNeta

BBVis is freely redistributable under the MIT License.  See LICENSE for details.
