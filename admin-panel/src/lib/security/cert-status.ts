import { X509Certificate } from 'node:crypto';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const EXPIRY_WARNING_DAYS = 21;

export interface CertificateStatus {
  readonly lineage: string;
  readonly subject: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly daysRemaining: number;
  readonly expiresSoon: boolean;
}

/** Null means "could not read this lineage", never "no certificate": the page shows the difference. */
export function describeLineage(lineage: string, pem: string, now: Date = new Date()): CertificateStatus | null {
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(pem);
  } catch {
    return null;
  }
  const validTo = new Date(certificate.validTo);
  const daysRemaining = Math.floor((validTo.getTime() - now.getTime()) / DAY_MS);
  return {
    lineage,
    subject: certificate.subject,
    validFrom: new Date(certificate.validFrom).toISOString(),
    validTo: validTo.toISOString(),
    daysRemaining,
    expiresSoon: daysRemaining <= EXPIRY_WARNING_DAYS,
  };
}
