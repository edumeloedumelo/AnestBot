import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { EventsGateway } from "./events/events.gateway";
import { EventsPublisher } from "./events/events.service";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Validação de entrada em todas as bordas (SECURITY.md §4).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({ origin: (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",") });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);

  // Tempo real: gateway WS no mesmo servidor HTTP + publisher do outbox.
  const gateway = app.get(EventsGateway);
  gateway.attach(app.getHttpServer());
  app.get(EventsPublisher).register(gateway);

  console.info(`Hospital OS API listening on :${port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
