# Third-party notices

The accompanying MIT license covers the original Open Overskill interface, server adapter, examples and documentation included in this source export. Third-party dependencies retain their own licenses. The export includes dependency manifests and a lockfile; it does not vendor `node_modules`, compiled dependency binaries, fonts, photos or other third-party media. This notice does not relicense upstream software or the managed Overskill service.

The versions below were checked against the included lockfile and installed package license files on October 1, 2026. Retain the applicable upstream copyright, license and notice files when redistributing dependencies in browser bundles, containers, executables or other built artifacts. Recheck notices after dependency updates; this source-package summary is not a complete notice bundle for every platform-specific build.

## Lucide icons and Feather attribution

The interface imports icons from `lucide-react` 0.469.0. Its complete installed `LICENSE` notice is reproduced below, including its attribution of Feather-derived portions:

```text
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

The Feather portions identified in that notice are MIT-licensed. Their MIT permission and disclaimer are also reproduced here, retaining the copyright holder and years identified by this installed Lucide version:

```text
The MIT License (MIT)

Copyright (c) 2013-2022 Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Sources: installed `node_modules/lucide-react/LICENSE`, [Lucide license](https://lucide.dev/license), [Feather license](https://github.com/feathericons/feather/blob/main/LICENSE).

## Direct dependencies and development tools

| Package and locked version | License | Installed notice / upstream source |
| --- | --- | --- |
| `next` 15.5.26 | MIT | `node_modules/next/license.md`; [Next.js license](https://github.com/vercel/next.js/blob/canary/license.md) |
| `react` and `react-dom` 19.2.8 | MIT | Each package's `LICENSE`; [React license](https://github.com/facebook/react/blob/main/LICENSE) |
| `openid-client` 6.8.8 | MIT | `node_modules/openid-client/LICENSE.md`; [openid-client license](https://github.com/panva/openid-client/blob/main/LICENSE.md) |
| `tailwindcss` and `@tailwindcss/postcss` 4.3.3 | MIT | Each package's `LICENSE`; [Tailwind CSS license](https://github.com/tailwindlabs/tailwindcss/blob/main/LICENSE) |
| `@types/node` 22.20.1, `@types/react` 19.2.18 and `@types/react-dom` 19.2.4 | MIT | Each package's `LICENSE`; [DefinitelyTyped license](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/LICENSE) |
| `typescript` 5.9.3 | Apache-2.0 | `node_modules/typescript/LICENSE.txt` and `ThirdPartyNoticeText.txt`; [TypeScript license](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt), [third-party notices](https://github.com/microsoft/TypeScript/blob/main/ThirdPartyNoticeText.txt) |

The installed package's notice corresponds to its locked version; upstream branch links are provided for reference and may change. Retain notices for transitive and bundled dependencies as well as these direct packages.

## Transitive licenses requiring separate treatment

The lockfile is not an all-MIT dependency tree. It includes:

- `caniuse-lite` 1.0.30001809 compatibility data under CC-BY-4.0. Preserve attribution and the applicable data license when redistributing that data. See its installed `LICENSE` and [upstream license](https://github.com/browserslist/caniuse-lite/blob/main/LICENSE).
- `lightningcss` 1.32.0 and its optional native packages under MPL-2.0. These are development/build dependencies. Preserve their license and meet applicable source-availability requirements if redistributing the covered software or modified covered files. See its installed `LICENSE`, [upstream license](https://github.com/parcel-bundler/lightningcss/blob/master/LICENSE), and [Mozilla's MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).
- `sharp` 0.35.5 under Apache-2.0, with optional platform packages that include LGPL-3.0-or-later libvips distributions and, for some targets, combined Apache/LGPL/MIT notices. Preserve the licenses, source-availability and other applicable redistribution requirements of the actual platform artifacts you ship. See the installed package notices, [Sharp licensing](https://sharp.pixelplumbing.com/#licensing), and [Sharp libvips distribution source](https://github.com/lovell/sharp-libvips).

Other lockfile entries include MIT, ISC, BSD-3-Clause and 0BSD licenses. Refer to the exact installed dependencies for their complete notices. Do not replace these upstream licenses with the starter's MIT license.

## Service and brand boundary

The original-code license grants rights to the exported source. Access to the Overskill API, hosted generation pipelines, credit purchases and other managed services is separate. Brand and trademark permissions are also separate. Referencing a provider or using its API does not imply endorsement or grant access to its private code or services.
