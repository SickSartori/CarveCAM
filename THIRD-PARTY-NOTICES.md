# Third-party components

CarveCAM is released under the [MIT License](LICENSE). It uses the following third-party components, each under its
own license.

| Component | Version | License | How it is used |
|---|---|---|---|
| [Clipper2](https://www.angusj.com/clipper2/Docs/Overview.htm) (Angus Johnson) | 2.0.0 | Boost Software License 1.0 | NuGet package, linked into `CarveCAM.exe` (polygon offset and booleans) |
| [.NET and ASP.NET Core](https://github.com/dotnet/runtime) (Microsoft) | 10 | MIT | Runtime bundled in the self-contained Windows package |
| [Three.js](https://threejs.org) | 0.170.0 | MIT | Loaded in the browser from jsDelivr (3D view and most mesh importers) |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | 0.8.3 | MIT | Loaded in the browser from jsDelivr |
| [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) | 0.0.17 | MIT | Loaded in the browser from jsDelivr (boolean operations between solids) |
| [occt-import-js](https://github.com/kovacsv/occt-import-js) with [Open CASCADE Technology](https://dev.opencascade.org) | 0.0.23 | LGPL-2.1 (Open CASCADE: LGPL-2.1 with additional exception) | WebAssembly module loaded in the browser from jsDelivr (STEP, IGES, BREP import); not redistributed with CarveCAM |
| [IBM Plex Sans](https://github.com/IBM/plex) | – | SIL Open Font License 1.1 | Loaded in the browser from Google Fonts |

Test projects only (not shipped): [xUnit](https://xunit.net) (Apache-2.0), Microsoft.NET.Test.Sdk (MIT),
coverlet (MIT).

Components loaded from a CDN are not part of this repository or of the Windows package: the browser downloads them
when CarveCAM is opened, which is why an internet connection is needed.
