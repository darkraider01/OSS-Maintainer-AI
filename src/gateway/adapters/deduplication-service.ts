import type { IDeduplicationService } from './communication-types.js';
import { logger } from '../../config/logger.js';

export class DeduplicationService implements IDeduplicationService {
  private readonly seen = new Set<string>();
  private readonly maxSize = 5000;

  async isDuplicate(eventId: string, correlationId?: string): Promise<boolean> {
    if (this.seen.has(eventId)) {
      logger.info({ correlationId, eventId }, 'Duplicate event detected by DeduplicationService');
      return true;
    }

    this.seen.add(eventId);
    // basic TTL cleanup simulation
    if (this.seen.size > this.maxSize) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) {
        this.seen.delete(oldest);
      }
    }

    return false;
  }
}
