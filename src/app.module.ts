import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConvertController } from './convert/convert.controller';
import { ConvertService } from './convert/convert.service';
import { LicenseController } from './license/license.controller';
import { LicenseService } from './license/license.service';

@Module({
  imports: [],
  controllers: [AppController, ConvertController, LicenseController],
  providers: [AppService, ConvertService, LicenseService],
})
export class AppModule {}
