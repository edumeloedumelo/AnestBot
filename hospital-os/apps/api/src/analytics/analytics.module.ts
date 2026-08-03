import { Controller, Get, Module, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser } from "../identity/auth.guard";
import { AuthenticatedUser } from "../identity/auth.service";
import { IdentityModule } from "../identity/identity.module";
import { IndicatorsService } from "./indicators.service";

@Controller("reports")
@UseGuards(AuthGuard)
class AnalyticsController {
  constructor(private readonly indicators: IndicatorsService) {}

  @Get("surgical-center")
  surgicalCenter(
    @CurrentUser() user: AuthenticatedUser,
    @Query("from") from: string,
    @Query("to") to: string
  ) {
    return this.indicators.surgicalCenterReport(user.tenantId, from, to);
  }
}

@Module({
  imports: [IdentityModule],
  controllers: [AnalyticsController],
  providers: [IndicatorsService],
  exports: [IndicatorsService],
})
export class AnalyticsModule {}
