# [libsm64-three](https://zalo.github.io/libsm64-three/)

<p align="left">
  <a href="https://github.com/zalo/libsm64-three/deployments/activity_log?environment=github-pages">
      <img src="https://img.shields.io/github/deployments/zalo/libsm64-three/github-pages?label=Github%20Pages%20Deployment" title="Github Pages Deployment"></a>
  <a href="https://github.com/zalo/libsm64-three/commits/main">
      <img src="https://img.shields.io/github/last-commit/zalo/libsm64-three" title="Last Commit Date"></a>
  <!--<a href="https://github.com/zalo/libsm64-three/blob/master/LICENSE">
      <img src="https://img.shields.io/github/license/zalo/libsm64-three" title="License: Apache V2"></a>-->  <!-- No idea what license this should be! -->
</p>

[!WARNING]
This repo is currently non-functional and still a work-in progress.

A simple testbed for running libsm64 in the browser.

 # Building

This demo can either be run without building (in Chrome/Edge/Opera since raw three.js examples need [Import Maps](https://caniuse.com/import-maps)), or built with:
```
npm install
npm run build
```
After building, make sure to edit the index .html to point from `"./src/main.js"` to `"./build/main.js"`.

 # Dependencies
 - [Webrio](https://github.com/osnr/Webrio) (Emscripten libsm64 Foundation and Reference)
 - [three.js](https://github.com/mrdoob/three.js/) (3D Rendering Engine)
 - [esbuild](https://github.com/evanw/esbuild/) (Bundler)
