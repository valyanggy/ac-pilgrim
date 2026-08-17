import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        imageDepth: resolve(import.meta.dirname, 'image-depth/index.html'),
        depthTravel: resolve(import.meta.dirname, 'depth-travel/index.html'),
        scanMask: resolve(import.meta.dirname, 'scan-mask/index.html'),
        scanMask031: resolve(import.meta.dirname, 'scan-mask-03-1/index.html'),
        scanVolume: resolve(import.meta.dirname, 'scan-volume/index.html'),
        originScan: resolve(import.meta.dirname, 'origin-scan/index.html'),
        gaussianScan: resolve(import.meta.dirname, 'gaussian-scan/index.html'),
        asciiScan: resolve(import.meta.dirname, 'ascii-scan/index.html'),
        meshScan: resolve(import.meta.dirname, 'mesh-scan/index.html'),
        meshScanOrganized: resolve(import.meta.dirname, 'mesh-scan-organized/index.html'),
        ditherTrail: resolve(import.meta.dirname, 'dither-trail/index.html'),
        shaderDither: resolve(import.meta.dirname, 'shader-dither/index.html'),
        dnaDither: resolve(import.meta.dirname, 'dna-dither/index.html'),
        dnaHelix: resolve(import.meta.dirname, 'dna-helix/index.html'),
        dnaHelixAtcg: resolve(import.meta.dirname, 'dna-helix-atcg/index.html'),
        ditherRender: resolve(import.meta.dirname, 'dither-render/index.html'),
        ditherRenderScroll: resolve(import.meta.dirname, 'dither-render-scroll/index.html'),
        ditherRenderOrganic: resolve(import.meta.dirname, 'dither-render-organic/index.html'),
        ditherRenderMaterial: resolve(import.meta.dirname, 'dither-render-material/index.html'),
        hoverPropagation: resolve(import.meta.dirname, 'hover-propagation/index.html'),
        videoDitherRelay: resolve(import.meta.dirname, 'video-dither-relay/index.html'),
        imageDither: resolve(import.meta.dirname, 'image-dither/index.html'),
        ringScan: resolve(import.meta.dirname, 'ring-scan/index.html'),
        heroStoryboard: resolve(import.meta.dirname, 'hero-storyboard/index.html'),
        heroStoryboard072: resolve(import.meta.dirname, 'hero-storyboard-07-2/index.html'),
        renderingStudies: resolve(import.meta.dirname, 'rendering-studies/index.html')
      }
    }
  }
});
