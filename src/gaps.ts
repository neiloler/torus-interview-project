import type { Config, Gap, Reading } from './types.ts';
import { acceptReading, type AcceptanceState } from './reading-acceptance.ts';
import { compareDeviceIds } from './compare-device-ids.ts';

/**
 * Tier 2. Report every gap in each device's accepted readings.
 * See "Tier 2" in the README.
 */
export function detectGaps(readings: Reading[], config: Config): Gap[] {
  const acceptance = new Map<string, AcceptanceState>();
  const devices = new Map<string, number[]>();

  // Acceptance depends on arrival order; sort only the accepted timestamps.
  for (const reading of readings) {
    if (!acceptReading(reading, acceptance, config)) continue;

    let timestamps = devices.get(reading.deviceId);
    if (!timestamps) {
      timestamps = [];
      devices.set(reading.deviceId, timestamps);
    }
    timestamps.push(reading.ts);
  }

  const gaps: Gap[] = [];
  for (const [deviceId, timestamps] of devices) {
    timestamps.sort((a, b) => a - b);

    for (let i = 1; i < timestamps.length; i++) {
      const start = timestamps[i - 1];
      const end = timestamps[i];
      if (end - start > config.gapMs) {
        gaps.push({ deviceId, start, end });
      }
    }
  }

  return gaps.sort((a, b) =>
    compareDeviceIds(a.deviceId, b.deviceId) || a.start - b.start,
  );
}
