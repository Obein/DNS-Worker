import assert from 'node:assert';
import {
  DEFAULT_PRESET_UPSTREAMS,
  DEFAULT_PRESET_EXTERNAL_FILTERS,
  getPresetUpstreams,
  getDefaultUpstreamUrl,
  getPresetExternalFilters
} from '../src/constants/presets';

async function runTests(): Promise<void> {
  console.log('>>> [TEST] Starting Preset Upstreams & Custom Env Configuration Tests...');

  // 1. Default fallback when env is missing or empty
  console.log('1. Testing default fallback without env variables...');
  const defaultUpstreams = getPresetUpstreams();
  assert.strictEqual(Array.isArray(defaultUpstreams), true);
  assert.strictEqual(defaultUpstreams.length, DEFAULT_PRESET_UPSTREAMS.length);
  assert.strictEqual(defaultUpstreams[0].url, DEFAULT_PRESET_UPSTREAMS[0].url);

  const defaultUrl = getDefaultUpstreamUrl();
  assert.strictEqual(defaultUrl, 'https://security.cloudflare-dns.com/dns-query');

  const defaultFilters = getPresetExternalFilters();
  assert.strictEqual(defaultFilters.length, DEFAULT_PRESET_EXTERNAL_FILTERS.length);
  assert.strictEqual(defaultFilters[0].url, DEFAULT_PRESET_EXTERNAL_FILTERS[0].url);
  console.log('   ✓ Default fallback verified.');

  // 2. Custom PRESET_UPSTREAMS from env
  console.log('2. Testing custom PRESET_UPSTREAMS extraction...');
  const customList = [
    { label: 'My Fast DNS', url: 'https://dns.example.com/dns-query' },
    { label: 'Fallback Quad9', url: 'https://dns.quad9.net/dns-query' }
  ];
  const envWithCustom = {
    PRESET_UPSTREAMS: JSON.stringify(customList)
  };

  const parsedUpstreams = getPresetUpstreams(envWithCustom);
  assert.strictEqual(parsedUpstreams.length, 2);
  assert.strictEqual(parsedUpstreams[0].label, 'My Fast DNS');
  assert.strictEqual(parsedUpstreams[0].url, 'https://dns.example.com/dns-query');

  // Verify getDefaultUpstreamUrl selects the FIRST item of the environment variable
  const selectedFirstUrl = getDefaultUpstreamUrl(envWithCustom);
  assert.strictEqual(selectedFirstUrl, 'https://dns.example.com/dns-query');
  console.log('   ✓ Custom PRESET_UPSTREAMS successfully resolved as default profile upstream.');

  // 3. Resilient error handling for invalid/corrupted env inputs
  console.log('3. Testing error resilience (corrupted JSON, empty array, non-array)...');
  const envMalformedJson = { PRESET_UPSTREAMS: '{ not-a-json ' };
  assert.strictEqual(getDefaultUpstreamUrl(envMalformedJson), DEFAULT_PRESET_UPSTREAMS[0].url);

  const envEmptyArray = { PRESET_UPSTREAMS: '[]' };
  assert.strictEqual(getDefaultUpstreamUrl(envEmptyArray), DEFAULT_PRESET_UPSTREAMS[0].url);

  const envNonArray = { PRESET_UPSTREAMS: '{"url":"test"}' };
  assert.strictEqual(getDefaultUpstreamUrl(envNonArray as any), DEFAULT_PRESET_UPSTREAMS[0].url);

  const envInvalidItems = {
    PRESET_UPSTREAMS: JSON.stringify([
      null,
      42,
      { label: 'no-url' },
      { label: 'Valid Custom', url: 'https://valid.dns.net/dns-query' }
    ])
  };
  const filteredUpstreams = getPresetUpstreams(envInvalidItems);
  assert.strictEqual(filteredUpstreams.length, 1);
  assert.strictEqual(filteredUpstreams[0].url, 'https://valid.dns.net/dns-query');
  assert.strictEqual(getDefaultUpstreamUrl(envInvalidItems), 'https://valid.dns.net/dns-query');
  console.log('   ✓ Error resilience and input sanitization verified.');

  // 4. Custom PRESET_EXTERNAL_FILTERS from env
  console.log('4. Testing custom PRESET_EXTERNAL_FILTERS extraction...');
  const customFilters = [
    { label: 'Custom List', url: 'https://filters.example.com/block.txt' }
  ];
  const envWithFilters = {
    PRESET_EXTERNAL_FILTERS: JSON.stringify(customFilters)
  };
  const parsedFilters = getPresetExternalFilters(envWithFilters);
  assert.strictEqual(parsedFilters.length, 1);
  assert.strictEqual(parsedFilters[0].url, 'https://filters.example.com/block.txt');
  console.log('   ✓ Custom PRESET_EXTERNAL_FILTERS verified.');

  console.log('\n======================================================');
  console.log('   ALL PRESET UPSTREAM & FILTER TESTS PASSED!          ');
  console.log('======================================================\n');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
