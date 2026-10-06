export function wrapFieldSampler(sampler) {
  let calls = 0;
  return {
    sampleField(x, y) {
      calls++;
      return sampler.sampleField(x, y);
    },
    get fieldEvals() {
      return calls;
    },
    resetFieldEvals() {
      calls = 0;
    },
  };
}
