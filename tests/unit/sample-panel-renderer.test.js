import { describe, expect, test } from '@jest/globals';
import {
  renderProjectSampleUsageHtml,
  renderSampleLibraryTreeHtml,
} from '../../src/ui/sample-panel-renderer.js';

describe('sample panel renderer', () => {
  test('renders global sample library tree with escaped sample metadata', () => {
    const html = renderSampleLibraryTreeHtml({
      name: 'root',
      dirs: [
        {
          name: 'drums',
          samples: [
            {
              id: 'kick-1',
              filename: '<kick>.wav',
              sampleLengthMs: 500,
              type: 'audio/wav',
              source: 'local',
            },
          ],
        },
      ],
      samples: [],
    });

    expect(html).toContain('/library');
    expect(html).toContain('/drums');
    expect(html).toContain('&lt;kick&gt;.wav');
    expect(html).not.toContain('<kick>');
    expect(html).toContain('data-sample-id="kick-1"');
  });

  test('renders project sample usage cards with peer query actions and progress fill', () => {
    const html = renderProjectSampleUsageHtml([
      {
        id: 'sampler-1/sample',
        sampleRef: 'sampler-1/sample',
        filename: '<lead>.wav',
        moduleTitle: 'Lead Sampler',
        availability: 'syncing',
        progress: 0.42,
        sampleLengthMs: 1200,
        type: 'audio/wav',
      },
    ]);

    expect(html).toContain('class="sample-slot-card state-syncing"');
    expect(html).toContain('data-sample-slot="sampler-1/sample"');
    expect(html).toContain('style="--sample-fill:42%"');
    expect(html).toContain('&lt;lead&gt;.wav');
    expect(html).toContain('data-sample-action="query-peer"');
    expect(html).toContain('data-sample-action="pick-upload"');
  });

  test('renders empty sample usage state', () => {
    expect(renderProjectSampleUsageHtml([])).toContain('No project sample references yet.');
  });
});
