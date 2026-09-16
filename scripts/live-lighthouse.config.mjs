// Instrument the same loader transition on both the old and new live builds.
// LIGHTHOUSE_ROOT points to an installed Lighthouse package (13.4.1 used here).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.env.LIGHTHOUSE_ROOT;
if (!root) throw new Error('Set LIGHTHOUSE_ROOT to the installed lighthouse package.');
const { default: BaseGatherer } = await import(pathToFileURL(resolve(root, 'core/gather/base-gatherer.js')));
const { Audit } = await import(pathToFileURL(resolve(root, 'core/audits/audit.js')));
class ViewerTimings extends BaseGatherer {
  meta = { supportedModes: ['navigation'] };
  async startInstrumentation({ driver }) {
    await driver.executionContext.evaluateOnNewDocument(() => {
      if (window !== window.top) return;
      const mark = name => {
        if (!performance.getEntriesByName(name).length) performance.mark(name);
      };
      const observer = new MutationObserver(() => {
        const poster = document.querySelector('#poster');
        if (poster?.complete && poster.naturalWidth) mark('live-poster-ready');
        if (document.querySelector('#loading')?.classList.contains('loaded')) {
          mark('live-3d-ready');
          observer.disconnect();
        }
      });
      observer.observe(document, { subtree: true, childList: true, attributes: true });
      document.addEventListener('load', event => {
        if (event.target.id === 'poster') mark('live-poster-ready');
      }, true);
    }, { args: [] });
  }
  getArtifact({ driver }) {
    return driver.executionContext.evaluate(() => ({
      ready: performance.getEntriesByName('live-3d-ready')[0]?.startTime,
      poster: performance.getEntriesByName('live-poster-ready')[0]?.startTime,
      modelURL: document.querySelector('#model-preload')?.href,
    }), { args: [], useIsolation: true });
  }
}
class ViewerReadyAudit extends Audit {
  static get meta() {
    return {
      id: 'viewer-ready', title: 'Complete 3D viewer reveal',
      description: 'Time from navigation start until the model loader is hidden.',
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      requiredArtifacts: ['ViewerTimings'],
    };
  }
  static audit({ ViewerTimings: timing }) {
    if (!Number.isFinite(timing.ready)) throw new Error('The 3D model did not finish before capture ended.');
    return {
      score: 1, numericValue: timing.ready, numericUnit: 'millisecond',
      displayValue: `${(timing.ready / 1000).toFixed(2)} s`,
      details: { type: 'debugdata', ...timing },
    };
  }
}
export default {
  extends: 'lighthouse:default',
  artifacts: [{ id: 'ViewerTimings', gatherer: new ViewerTimings() }],
  audits: [ViewerReadyAudit],
  categories: {
    viewer: { title: '3D viewer', auditRefs: [{ id: 'viewer-ready', weight: 0 }] },
  },
};
