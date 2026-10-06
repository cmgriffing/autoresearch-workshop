/**
 * Compute a 32-bit big-endian checksum on a Uint8Array or array of bytes.
 * @param {Uint8Array|number[]} arr
 * @returns {number} Unsigned 32-bit integer
 */
function checksum(arr) {
  if (arr.length === 0) return 0;

  // Initialize sums as standard integers
  let sum0 = 0,
    sum1 = 0,
    sum2 = 0,
    sum3 = 0;

  for (let i = 0; i < arr.length; i++) {
    switch (i % 4) {
      case 0:
        sum0 = (sum0 + arr[i]) | 0;
        break;
      case 1:
        sum1 = (sum1 + arr[i]) | 0;
        break;
      case 2:
        sum2 = (sum2 + arr[i]) | 0;
        break;
      case 3:
        sum3 = (sum3 + arr[i]) | 0;
        break;
    }
  }

  // Shift and combine using bitwise operators
  // The final '>>> 0' forces the result to be an unsigned 32-bit integer
  const sum = (sum3 + (sum2 << 8) + (sum1 << 16) + (sum0 << 24)) >>> 0;

  return sum;
}
