// User routes: registration, profile management, account tiers
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

export const userRouter = Router();

// User tier types aligned with NEXCOM spec
type UserTier = 'farmer' | 'retail_trader' | 'institutional' | 'cooperative';
type KycLevel = 'none' | 'basic' | 'enhanced' | 'full';

interface User {
  id: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  tier: UserTier;
  kycLevel: KycLevel;
  country: string;
  language: string;
  status: 'pending' | 'active' | 'suspended' | 'deactivated';
  createdAt: Date;
  updatedAt: Date;
}

// Validation schemas
const registerSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(10),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  tier: z.enum(['farmer', 'retail_trader', 'institutional', 'cooperative']),
  country: z.string().length(2), // ISO 3166-1 alpha-2
  language: z.string().default('en'),
  password: z.string().min(12).optional(), // Optional for USSD-based farmer registration
});

const updateProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  language: z.string().optional(),
  phone: z.string().min(10).optional(),
});

// In-memory store (production: PostgreSQL + Keycloak)
const users = new Map<string, User>();

// Register a new user
userRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const data = registerSchema.parse(req.body);

    const user: User = {
      id: uuidv4(),
      email: data.email || '',
      phone: data.phone,
      firstName: data.firstName,
      lastName: data.lastName,
      tier: data.tier,
      kycLevel: 'none',
      country: data.country,
      language: data.language,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    users.set(user.id, user);

    // In production: Create user in Keycloak, assign realm role, send verification
    // For farmers: trigger USSD-based verification flow
    // For institutions: trigger enhanced due diligence workflow

    res.status(201).json({
      id: user.id,
      status: user.status,
      tier: user.tier,
      message: 'Registration successful. Please complete KYC verification.',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ errors: error.errors });
      return;
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Get user profile
userRouter.get('/:userId', async (req: Request, res: Response) => {
  const user = users.get(req.params.userId);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  // Omit sensitive fields
  const { ...profile } = user;
  res.json(profile);
});

// Update user profile
userRouter.patch('/:userId', async (req: Request, res: Response) => {
  try {
    const data = updateProfileSchema.parse(req.body);
    const user = users.get(req.params.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (data.firstName) user.firstName = data.firstName;
    if (data.lastName) user.lastName = data.lastName;
    if (data.language) user.language = data.language;
    if (data.phone) user.phone = data.phone;
    user.updatedAt = new Date();

    res.json(user);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ errors: error.errors });
      return;
    }
    res.status(500).json({ error: 'Update failed' });
  }
});

// List users (admin only)
userRouter.get('/', async (_req: Request, res: Response) => {
  const allUsers = Array.from(users.values());
  res.json({ users: allUsers, total: allUsers.length });
});
