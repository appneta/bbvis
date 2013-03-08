# BBVis

BBVis is a Chrome extension that tracks event bindings between
Backbone views, models, and collections, and displays these connections in
a Developer Tools panel.  It's especially useful in understanding connections
between complex applications with many interdependent models and views.

<center><a href="http://imgur.com/zzefiGr.png" target="_new"><img src="http://imgur.com/zzefiGr.png" width="400px"></a></center>

BBVis was built specifically for use with TBone, but should work with regular
Backbone apps within the limitations below.

## Installation

- Open chrome://extensions
- Enable Developer Mode
- Select `Load unpacked extension...`
- Find and select this `bbvis` folder
- (Re-)open the developer tools console; there should be a new BBVis tab.

## Known working sites

There are still some fairly jagged edges, but try these out to see bbvis in action:

- http://tbonejs.org/
- http://addyosmani.github.com/todomvc/architecture-examples/backbone/
- http://www.dbpatterns.com/documents/507d2e6e89cbad2046a3e1f0

The screenshot above is from our web performance app at
http://www.appneta.com/application-performance-management/

## TODO

- View render highlighting is not yet imported from pre-extension implementation.

## Limitations

- BBVis will not be able to understand connections between objects unless the
  context is specified in Backbone .on() calls.
- BBVis may not be able to detect all your models and views if they are
  created & bound in the same script as Backbone.  BBVis attempts to instrument
  Backbone after every script on a page loads.

## Acknowledgements

In addition to JQuery, D3, Backbone, Underscore, and Bootstrap, BBVis includes a
fantastic [Dagre](https://github.com/cpettitt/dagre) directed graph layout
implementation by [Chris Pettitt](https://github.com/cpettitt).

## License

Copyright (c) 2012 Dan Tillberg, AppNeta

BBVis is freely redistributable under the MIT License.  See LICENSE for details.
