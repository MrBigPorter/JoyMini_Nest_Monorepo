import {
  Controller,
  Get,
  Query,
  UseGuards,
  Header,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { MediaService } from './media.service';

@ApiTags('Media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * Proxy Google Static Map image
   * @param lat
   * @param lng
   */
  @Get('static-map')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Proxy Google Static Map image' })
  @ApiQuery({ name: 'lat', required: true, type: Number })
  @ApiQuery({ name: 'lng', required: true, type: Number })
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'public, max-age=2592000')
  async getStaticMap(
    @Query('lat') lat: number,
    @Query('lng') lng: number,
  ): Promise<StreamableFile> {
    const imageBuffer = await this.mediaService.getStaticMapProxy(lat, lng);
    //  5. return StreamableFile, nest will handle the response
    return new StreamableFile(imageBuffer);
  }
}
