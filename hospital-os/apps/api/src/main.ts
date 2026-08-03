import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Validação de entrada em todas as bordas (SECURITY.md §4).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.info(`Hospital OS API listening on :${port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
