import { Global, Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { EventsGateway } from "./events.gateway";
import { EventsPublisher, EventsService } from "./events.service";

@Global()
@Module({
  imports: [IdentityModule],
  providers: [EventsService, EventsPublisher, EventsGateway],
  exports: [EventsService, EventsPublisher, EventsGateway],
})
export class EventsModule {}
