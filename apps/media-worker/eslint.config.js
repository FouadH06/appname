import base from '@app/eslint-config/base';

// bench/edge runs in the Deno edge runtime (npm: specifiers), not Node
export default [...base, { ignores: ['bench/edge/**', 'bench/corpus/**', 'bench/results/**'] }];
