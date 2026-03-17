# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.3.0](https://github.com/0xPolygon/polygon-agent-cli/compare/@polygonlabs/agent-cli@0.2.2...@polygonlabs/agent-cli@0.3.0) (2026-03-17)


### Bug Fixes

* add missing @polymarket/order-utils dependency ([54fe8a2](https://github.com/0xPolygon/polygon-agent-cli/commit/54fe8a2a80c0f40cbad6ad20073e0d51e1309885))
* bump sequence SDK to beta.17 for counterfactual wallet support ([879e06f](https://github.com/0xPolygon/polygon-agent-cli/commit/879e06fabe1813187a5932ac6adde1c6c78441db))
* resolve file system race condition in polymarket key storage ([bf12021](https://github.com/0xPolygon/polygon-agent-cli/commit/bf1202160d50987540268539e3b66150cb645ffd))


### Features

* **polymarket:** port polymarket feature to TypeScript ([1a67055](https://github.com/0xPolygon/polygon-agent-cli/commit/1a67055e4f02b04f4fbf16e076d500901dcc47f2))
* **polymarket:** port to TypeScript, fix factory routing, update docs ([48f8636](https://github.com/0xPolygon/polygon-agent-cli/commit/48f8636600a278d512be0c377969e24178325078))





## [0.2.2](https://github.com/0xPolygon/polygon-agent-cli/compare/@polygonlabs/agent-cli@0.2.1...@polygonlabs/agent-cli@0.2.2) (2026-03-05)


### Bug Fixes

* **agent:** handle empty clients list in reputation command ([4a95561](https://github.com/0xPolygon/polygon-agent-cli/commit/4a955616089b604e10d442461f944403e62a207e))





## [0.2.1](https://github.com/0xPolygon/polygon-agent-cli/compare/@polygonlabs/agent-cli@0.2.0...@polygonlabs/agent-cli@0.2.1) (2026-03-05)


### Bug Fixes

* **publish:** add repository field to package.json files ([b037364](https://github.com/0xPolygon/polygon-agent-cli/commit/b037364323343900a041e16e4b8f7ff92345d95e))





# [0.2.0](https://github.com/0xPolygon/polygon-agent-cli/compare/@polygonlabs/agent-cli@0.1.2...@polygonlabs/agent-cli@0.2.0) (2026-03-04)


### Bug Fixes

* **dapp-client:** use getAndClear methods instead of save(null) ([6331f98](https://github.com/0xPolygon/polygon-agent-cli/commit/6331f98f919b077ced2dbc87b66f51aeec8c73a7))
* **release:** reset version to 0.1.2 and drop --conventional-graduate ([73ad183](https://github.com/0xPolygon/polygon-agent-cli/commit/73ad18302ea6aa71d2a0860d3f82abd3f663c2cd))
* **swap:** poll waitIntentReceipt until done instead of single call ([e815bc6](https://github.com/0xPolygon/polygon-agent-cli/commit/e815bc69478e78223918b95dd256ae01e90373ff))
* **swap:** use correct property path for intent status in timeout error ([ab88ba8](https://github.com/0xPolygon/polygon-agent-cli/commit/ab88ba8dad8f07ce2236a538a9fd9ce1eb9a09d4))
* **wallet:** auto-whitelist ValueForwarder and Trails contracts at session creation ([adc302a](https://github.com/0xPolygon/polygon-agent-cli/commit/adc302a708a1713410c8d0a62f4f5e67836d401a))
* **wallet:** remove Trails deposit contracts from auto-whitelist ([aeb78ca](https://github.com/0xPolygon/polygon-agent-cli/commit/aeb78ca0aea84a64d11cb5e9db4d24220e734f05))


### Features

* add version to cli commands ([5aa2d75](https://github.com/0xPolygon/polygon-agent-cli/commit/5aa2d75fa0c306686aa390f27d70a0eec0231dc4))
* **cli:** convert polygon-agent-cli from JavaScript to TypeScript + yargs ([186044d](https://github.com/0xPolygon/polygon-agent-cli/commit/186044d1262a4cc059b2ce1f93b982ab58dbc0e7))
* **cli:** show help when command is called without required subcommand ([8b87c5e](https://github.com/0xPolygon/polygon-agent-cli/commit/8b87c5e51ce900475e24676fa48dd06eea58ca7a))
* **cli:** show subcommands in root --help descriptions ([9a7c390](https://github.com/0xPolygon/polygon-agent-cli/commit/9a7c390010f5bc9117cc57b73b8c6d8eb12eaeda))
