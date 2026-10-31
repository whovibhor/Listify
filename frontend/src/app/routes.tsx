import { Navigate, type RouteObject } from 'react-router'

import { ComingSoonPage } from '@/app/pages/ComingSoonPage'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { RouteErrorBoundary } from '@/app/RouteErrorBoundary'
import { AppShell } from '@/components/layout/AppShell'
import { allNavItems } from '@/components/layout/navigation'
import { AuthLayout } from '@/features/auth/components/AuthLayout'
import { GuestOnly, RequireAuth } from '@/features/auth/components/RouteGuards'
import { OrganizationLayout } from '@/features/organizations/components/OrganizationLayout'
import { ForgotPasswordPage } from '@/features/auth/pages/ForgotPasswordPage'
import { LoginPage } from '@/features/auth/pages/LoginPage'
import { RegisterPage } from '@/features/auth/pages/RegisterPage'
import { ResetPasswordPage } from '@/features/auth/pages/ResetPasswordPage'
import { WelcomePage } from '@/features/auth/pages/WelcomePage'
import { SettingsLayout } from '@/features/settings/components/SettingsLayout'
import { ProfileSettingsPage } from '@/features/settings/pages/ProfileSettingsPage'
import { SecuritySettingsPage } from '@/features/settings/pages/SecuritySettingsPage'
import { OrganizationsSettingsPage } from '@/features/settings/pages/OrganizationsSettingsPage'
import { HomeRoute } from '@/features/system/pages/HomePage'

const plannedRoutes: RouteObject[] = allNavItems
  .filter((item) => item.plannedMilestone)
  .map((item) => ({ path: item.to, element: <ComingSoonPage /> }))

// Personal workspace pages are code-split; analytics also pulls in the charting library.
const personalRoutes: RouteObject[] = [
  {
    path: '/personal/my-day',
    lazy: async () => ({
      Component: (await import('@/features/personal-tasks/pages/MyDayPage')).MyDayPage,
    }),
  },
  {
    path: '/personal/tasks',
    lazy: async () => ({
      Component: (await import('@/features/personal-tasks/pages/MyTasksPage')).MyTasksPage,
    }),
  },
  {
    path: '/personal/upcoming',
    lazy: async () => ({
      Component: (await import('@/features/personal-tasks/pages/UpcomingPage')).UpcomingPage,
    }),
  },
  {
    path: '/personal/completed',
    lazy: async () => ({
      Component: (await import('@/features/personal-tasks/pages/CompletedPage')).CompletedPage,
    }),
  },
  {
    path: '/personal/analytics',
    lazy: async () => ({
      Component: (await import('@/features/dashboards/pages/PersonalAnalyticsPage'))
        .PersonalAnalyticsPage,
    }),
  },
]

const organizationRoutes: RouteObject[] = [
  {
    path: '/inbox',
    lazy: async () => ({
      Component: (await import('@/features/inbox/pages/InboxPage')).InboxPage,
    }),
  },
  {
    path: '/organizations/new',
    lazy: async () => ({
      Component: (await import('@/features/organizations/pages/CreateOrganizationPage'))
        .CreateOrganizationPage,
    }),
  },
  {
    path: '/organizations/join',
    lazy: async () => ({
      Component: (await import('@/features/organizations/pages/JoinOrganizationPage'))
        .JoinOrganizationPage,
    }),
  },
  {
    path: '/invite/:token',
    lazy: async () => ({
      Component: (await import('@/features/organizations/pages/InvitationPage')).InvitationPage,
    }),
  },
  {
    path: '/org/:organizationId',
    element: <OrganizationLayout />,
    children: [
      {
        index: true,
        lazy: async () => ({
          Component: (await import('@/features/organizations/pages/OrganizationOverviewPage'))
            .OrganizationOverviewPage,
        }),
      },
      {
        path: 'departments',
        lazy: async () => ({
          Component: (await import('@/features/organizations/pages/DepartmentsPage'))
            .DepartmentsPage,
        }),
      },
      {
        path: 'departments/:departmentId',
        lazy: async () => ({
          Component: (await import('@/features/work/pages/DepartmentBoardPage'))
            .DepartmentBoardPage,
        }),
      },
      {
        path: 'my-work',
        lazy: async () => ({
          Component: (await import('@/features/work/pages/MyWorkPage')).MyWorkPage,
        }),
      },
      {
        path: 'tasks',
        lazy: async () => ({
          Component: (await import('@/features/work/pages/TeamTasksPage')).TeamTasksPage,
        }),
      },
      {
        path: 'reports',
        lazy: async () => ({
          Component: (await import('@/features/reports/pages/ReportsPage')).ReportsPage,
        }),
      },
      {
        path: 'reports/departments/:departmentId',
        lazy: async () => ({
          Component: (await import('@/features/reports/pages/DepartmentReportPage'))
            .DepartmentReportPage,
        }),
      },
      {
        path: 'reports/members/:userId',
        lazy: async () => ({
          Component: (await import('@/features/reports/pages/MemberSummaryPage')).MemberSummaryPage,
        }),
      },
      {
        path: 'members',
        lazy: async () => ({
          Component: (await import('@/features/organizations/pages/MembersPage')).MembersPage,
        }),
      },
      {
        path: 'requests',
        lazy: async () => ({
          Component: (await import('@/features/organizations/pages/RequestsPage')).RequestsPage,
        }),
      },
      {
        path: 'invitations',
        lazy: async () => ({
          Component: (await import('@/features/organizations/pages/InvitationsPage'))
            .InvitationsPage,
        }),
      },
      {
        path: 'activity',
        lazy: async () => ({
          Component: (await import('@/features/organizations/pages/AuditLogPage')).AuditLogPage,
        }),
      },
      {
        path: 'settings',
        lazy: async () => ({
          Component: (await import('@/features/organizations/pages/OrganizationSettingsPage'))
            .OrganizationSettingsPage,
        }),
      },
    ],
  },
]

const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: '/design',
        lazy: async () => {
          const { DesignSystemPage } = await import('@/features/system/pages/DesignSystemPage')
          return { Component: DesignSystemPage }
        },
      },
    ]
  : []

// Feature pages are lazy-loaded (route.lazy) as they grow, keeping the initial bundle small.
export const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <AuthLayout />,
        children: [
          {
            element: <GuestOnly />,
            children: [
              { path: '/login', element: <LoginPage /> },
              { path: '/register', element: <RegisterPage /> },
              { path: '/forgot-password', element: <ForgotPasswordPage /> },
            ],
          },
          // Reachable signed in or out: the emailed link must always work.
          { path: '/reset-password', element: <ResetPasswordPage /> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, element: <HomeRoute /> },
              { path: '/welcome', element: <WelcomePage /> },
              {
                path: '/settings',
                element: <SettingsLayout />,
                children: [
                  { index: true, element: <Navigate to="profile" replace /> },
                  { path: 'profile', element: <ProfileSettingsPage /> },
                  { path: 'security', element: <SecuritySettingsPage /> },
                  { path: 'organizations', element: <OrganizationsSettingsPage /> },
                ],
              },
              ...personalRoutes,
              ...organizationRoutes,
              ...plannedRoutes,
              ...devRoutes,
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
]
