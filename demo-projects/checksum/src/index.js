/**
 * Compute a 32-bit big-endian checksum on a Uint8Array or array of bytes.
 * @param {Uint8Array|number[]} arr
 * @returns {number} Unsigned 32-bit integer
 */
export function checksum(arr) {
  if (arr.length === 0) return 0;

  // Initialize sums
  let sum0 = 0, sum1 = 0, sum2 = 0, sum3 = 0;

  // 16-element loop unrolling (optimal balance)
  const len = arr.length;
  const unroll = 16;
  const mask = unroll - 1; // 15 for power of 2 unroll
  const end = len - (len & mask);

  for (let i = 0; i < end; i += unroll) {
    sum0 = (sum0 + arr[i]) | 0;
    sum1 = (sum1 + arr[i + 1]) | 0;
    sum2 = (sum2 + arr[i + 2]) | 0;
    sum3 = (sum3 + arr[i + 3]) | 0;
    sum0 = (sum0 + arr[i + 4]) | 0;
    sum1 = (sum1 + arr[i + 5]) | 0;
    sum2 = (sum2 + arr[i + 6]) | 0;
    sum3 = (sum3 + arr[i + 7]) | 0;
    sum0 = (sum0 + arr[i + 8]) | 0;
    sum1 = (sum1 + arr[i + 9]) | 0;
    sum2 = (sum2 + arr[i + 10]) | 0;
    sum3 = (sum3 + arr[i + 11]) | 0;
    sum0 = (sum0 + arr[i + 12]) | 0;
    sum1 = (sum1 + arr[i + 13]) | 0;
    sum2 = (sum2 + arr[i + 14]) | 0;
    sum3 = (sum3 + arr[i + 15]) | 0;
  }

  // Handle remainder with switch (optimal for small number of cases)
  const rem = len & mask;
  const offset = end;
  switch (rem) {
    case 15:
      sum2 = (sum2 + arr[offset + 14]) | 0;
    case 14:
      sum1 = (sum1 + arr[offset + 13]) | 0;
    case 13:
      sum0 = (sum0 + arr[offset + 12]) | 0;
    case 12:
      sum3 = (sum3 + arr[offset + 11]) | 0;
    case 11:
      sum2 = (sum2 + arr[offset + 10]) | 0;
    case 10:
      sum1 = (sum1 + arr[offset + 9]) | 0;
    case 9:
      sum0 = (sum0 + arr[offset + 8]) | 0;
    case 8:
      sum3 = (sum3 + arr[offset + 7]) | 0;
    case 7:
      sum2 = (sum2 + arr[offset + 6]) | 0;
    case 6:
      sum1 = (sum1 + arr[offset + 5]) | 0;
    case 5:
      sum0 = (sum0 + arr[offset + 4]) | 0;
    case 4:
      sum3 = (sum3 + arr[offset + 3]) | 0;
    case 3:
      sum2 = (sum2 + arr[offset + 2]) | 0;
    case 2:
      sum1 = (sum1 + arr[offset + 1]) | 0;
    case 1:
      sum0 = (sum0 + arr[offset]) | 0;
    case 0:
      break;
  }

  // Combine lanes
  return (sum3 + (sum2 << 8) + (sum1 << 16) + (sum0 << 24)) >>> 0;
}
