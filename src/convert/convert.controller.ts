import {
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ConvertService } from './convert.service';

@Controller('api/convert')
export class ConvertController {
  constructor(private readonly convertService: ConvertService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  create(
    @UploadedFile()
    file: {
      originalname: string;
      buffer: Buffer;
      size: number;
    },
  ) {
    return this.convertService.createJob(file);
  }

  @Get(':id/progress')
  getProgress(@Param('id') id: string) {
    return this.convertService.getProgress(id);
  }

  @Get(':id/download')
  download(@Param('id') id: string, @Res() response: Response) {
    const file = this.convertService.getDownloadInfo(id);
    const encodedFileName = encodeURIComponent(file.fileName);
    const fallbackFileName = file.fileName.replace(/[^\x20-\x7E]/g, '_');

    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${fallbackFileName}"; filename*=UTF-8''${encodedFileName}`,
    );

    return this.convertService.createDownloadStream(file.path).pipe(response);
  }
}
