import { PrismaClient } from '../src/generated/prisma/client'
const prisma = new PrismaClient()
const scrapers = await prisma.scraper.findMany({ orderBy: { name: 'asc' } })
console.table(scrapers.map(s => ({ appId: s.appId, name: s.name, isActive: s.isActive })))
const sessions = await prisma.checkSession.groupBy({ by: ['appId'], _count: true })
console.log('\nSessions per scraper:')
console.table(sessions)
await prisma.$disconnect()
