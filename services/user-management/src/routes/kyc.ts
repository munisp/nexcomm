// KYC/AML routes: document upload, verification status, compliance checks
// Integrates with Temporal for long-running KYC workflows
import { Router, Request, Response } from 'express';
import { z } from 'zod';

export const kycRouter = Router();

type KycStatus = 'not_started' | 'documents_submitted' | 'under_review' | 'approved' | 'rejected' | 'expired';
type DocumentType = 'national_id' | 'passport' | 'drivers_license' | 'utility_bill' | 'bank_statement' | 'business_registration';

interface KycSubmission {
  id: string;
  userId: string;
  level: string;
  status: KycStatus;
  documents: KycDocument[];
  submittedAt: Date;
  reviewedAt?: Date;
  reviewerNotes?: string;
}

interface KycDocument {
  type: DocumentType;
  fileUrl: string;
  status: 'pending' | 'verified' | 'rejected';
  uploadedAt: Date;
}

const kycSubmissions = new Map<string, KycSubmission>();

const submitKycSchema = z.object({
  userId: z.string().uuid(),
  level: z.enum(['basic', 'enhanced', 'full']),
  documents: z.array(z.object({
    type: z.enum(['national_id', 'passport', 'drivers_license', 'utility_bill', 'bank_statement', 'business_registration']),
    fileUrl: z.string().url(),
  })),
});

// Submit KYC documents
kycRouter.post('/submit', async (req: Request, res: Response) => {
  try {
    const data = submitKycSchema.parse(req.body);

    const submission: KycSubmission = {
      id: crypto.randomUUID(),
      userId: data.userId,
      level: data.level,
      status: 'documents_submitted',
      documents: data.documents.map(doc => ({
        type: doc.type,
        fileUrl: doc.fileUrl,
        status: 'pending' as const,
        uploadedAt: new Date(),
      })),
      submittedAt: new Date(),
    };

    kycSubmissions.set(submission.id, submission);

    // In production: Start Temporal KYC workflow
    // Workflow steps: document validation → identity verification → sanctions screening → approval

    res.status(201).json({
      submissionId: submission.id,
      status: submission.status,
      message: 'KYC documents submitted. Review typically takes 1-3 business days.',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ errors: error.errors });
      return;
    }
    res.status(500).json({ error: 'KYC submission failed' });
  }
});

// Get KYC status for a user
kycRouter.get('/status/:userId', async (req: Request, res: Response) => {
  const submissions = Array.from(kycSubmissions.values())
    .filter(s => s.userId === req.params.userId)
    .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());

  if (submissions.length === 0) {
    res.json({ status: 'not_started', level: 'none' });
    return;
  }

  const latest = submissions[0];
  res.json({
    submissionId: latest.id,
    status: latest.status,
    level: latest.level,
    submittedAt: latest.submittedAt,
    reviewedAt: latest.reviewedAt,
  });
});

// Get detailed KYC submission
kycRouter.get('/submission/:submissionId', async (req: Request, res: Response) => {
  const submission = kycSubmissions.get(req.params.submissionId);
  if (!submission) {
    res.status(404).json({ error: 'Submission not found' });
    return;
  }
  res.json(submission);
});
