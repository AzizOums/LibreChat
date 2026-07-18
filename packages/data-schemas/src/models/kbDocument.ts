import { Model } from 'mongoose';
import type { IKbDocument } from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import kbDocumentSchema from '~/schema/kbDocument';

export function createKbDocumentModel(mongoose: typeof import('mongoose')): Model<IKbDocument> {
  applyTenantIsolation(kbDocumentSchema);
  return mongoose.models.KbDocument || mongoose.model<IKbDocument>('KbDocument', kbDocumentSchema);
}
