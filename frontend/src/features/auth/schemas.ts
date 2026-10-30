import { z } from 'zod'

// Mirrors the server's length rules for instant feedback; the server remains authoritative
// (common-password and email checks happen there and come back as field errors).
export const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_LENGTH = 128

const email = z
  .string()
  .trim()
  .min(1, 'Enter your email.')
  .pipe(z.email('Enter a valid email address.'))

const newPassword = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(MAX_PASSWORD_LENGTH, `Use at most ${MAX_PASSWORD_LENGTH} characters.`)

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.'),
})

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(100, 'Use at most 100 characters.'),
  email,
  password: newPassword,
  accept_terms: z.boolean().refine((value) => value, 'You need to accept the terms to continue.'),
})

export const forgotPasswordSchema = z.object({ email })

export const resetPasswordSchema = z
  .object({ password: newPassword, confirm: z.string() })
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: "Passwords don't match.",
  })

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, 'Enter your current password.'),
    new_password: newPassword,
    confirm: z.string(),
  })
  .refine((values) => values.new_password === values.confirm, {
    path: ['confirm'],
    message: "Passwords don't match.",
  })

export const profileSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(100, 'Use at most 100 characters.'),
  timezone: z.string().min(1, 'Choose a timezone.'),
})

export type LoginValues = z.infer<typeof loginSchema>
export type RegisterValues = z.infer<typeof registerSchema>
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>
export type ProfileValues = z.infer<typeof profileSchema>
