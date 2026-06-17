import { describe, expect, test } from '@jest/globals';
import {
  renderProjectSampleUsageHtml,
  renderSampleLibraryMatrixHtml,
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
        moduleId: 'lead-sampler',
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
    expect(html).toContain('data-sample-action="open-editor"');
    expect(html).toContain('data-module-id="lead-sampler"');
    expect(html).toContain('Open Samples to swap this buffer');
  });

  test('renders empty sample usage state', () => {
    expect(renderProjectSampleUsageHtml([])).toContain('No project sample references yet.');
  });

  test('renders sample library matrix with files, all slots, and mix-match actions', () => {
    const html = renderSampleLibraryMatrixHtml({
      samples: [
        { id: 'kick-1', filename: '<kick>.wav', sampleLengthMs: 500, source: 'local' },
        { id: 'snare-1', filename: 'snare.wav', sampleLengthMs: 700, source: 'peer' },
      ],
      slots: [
        {
          id: 'drums-1/kick',
          sampleRef: 'drums-1/kick',
          moduleId: 'drums-1',
          moduleTitle: 'Drums',
          slotLabel: 'Kick',
          filename: 'kick.wav',
          availability: 'available',
        },
        {
          id: 'drums-1/snare',
          sampleRef: 'drums-1/snare',
          moduleId: 'drums-1',
          moduleTitle: 'Drums',
          slotLabel: 'Snare',
          availability: 'empty',
        },
        {
          id: 'drums-1/hat',
          sampleRef: 'drums-1/hat',
          moduleId: 'drums-1',
          moduleTitle: 'Drums',
          slotLabel: 'Hat',
          filename: 'hat.wav',
          availability: 'missing',
        },
      ],
      selectedSampleId: 'kick-1',
    });

    expect(html).toContain('sample-library-matrix');
    expect(html).toContain('data-sample-id="kick-1"');
    expect(html).toContain('data-sample-action="preview-sample"');
    expect(html).toContain('PREVIEW');
    expect(html).toContain('&lt;kick&gt;.wav');
    expect(html).not.toContain('<kick>');
    expect(html).toContain('data-sample-slot="drums-1/snare"');
    expect(html).toContain('state-empty');
    expect(html).toContain('data-sample-action="assign-selected"');
    expect(html).toContain('data-sample-action="open-editor"');
    expect(html).toContain('data-sample-action="query-peer"');
    expect(html).toContain('Selected sample');
  });

  test('renders empty slots without peer query and disables assignment until a sample is selected', () => {
    const html = renderSampleLibraryMatrixHtml({
      samples: [],
      slots: [
        {
          id: 'drums-1/snare',
          sampleRef: 'drums-1/snare',
          moduleId: 'drums-1',
          moduleTitle: 'Drums',
          slotLabel: 'Snare',
          availability: 'empty',
        },
        {
          id: 'drums-1/kick',
          sampleRef: 'drums-1/kick',
          moduleId: 'drums-1',
          moduleTitle: 'Drums',
          slotLabel: 'Kick',
          filename: 'kick.wav',
          availability: 'missing',
        },
      ],
    });

    const emptySlotHtml =
      html.match(/<tr class="sample-matrix-slot state-empty"[\s\S]*?<\/tr>/)?.[0] || '';
    const missingSlotHtml =
      html.match(/<tr class="sample-matrix-slot state-missing"[\s\S]*?<\/tr>/)?.[0] || '';

    expect(emptySlotHtml).toContain('disabled');
    expect(emptySlotHtml).toContain('Select a file first');
    expect(emptySlotHtml).not.toContain('data-sample-action="query-peer"');
    expect(missingSlotHtml).toContain('data-sample-action="query-peer"');
  });
});
