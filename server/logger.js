// Структурированный логгер на pino. В prod — JSON в stdout (под Loki/ELK),
// в dev — pino-pretty (читаемо).
//
// Уровень управляется LOG_LEVEL (trace|debug|info|warn|error|fatal),
// по умолчанию 'info'. В тестах NODE_ENV=test → 'silent', чтобы вывод
// vitest не утопал в логах прогрева.
import pino from 'pino'

const isProd = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'

const level = process.env.LOG_LEVEL || (isTest ? 'silent' : 'info')

// В dev форматируем через pino-pretty (transport-worker). В prod — сырой JSON
// без транспорта: быстрее, проще для агрегаторов. В тестах транспорт не нужен.
const transport = !isProd && !isTest
  ? {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
        singleLine: false
      }
    }
  : undefined

export const logger = pino({
  level,
  transport,
  // base.app пишется в каждую запись — удобно фильтровать в Loki/ELK
  // когда лог-стрим разделяется с другими сервисами.
  base: { app: 'apn-vue' },
  // ISO-таймстампы человекочитаемее, чем UNIX-ms (pino default).
  timestamp: pino.stdTimeFunctions.isoTime,
  // err: { ... } автоматически сериализуется с stack-trace через стандартный
  // pino-serializer.
  serializers: { err: pino.stdSerializers.err }
})

// child-логгеры для основных модулей — добавляют поле module=… ко всему,
// что через них пишется. Полезно для grep'а: `level=error module=maintenance`.
export const serverLog = logger.child({ module: 'server' })
export const maintLog = logger.child({ module: 'maintenance' })
export const storageLog = logger.child({ module: 'storage' })
export const jwtLog = logger.child({ module: 'jwt' })
