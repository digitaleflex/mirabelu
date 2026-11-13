-- Suspension d'un compte et remboursement d'un paiement.
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';

ALTER TABLE "User" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "suspensionReason" TEXT;
