/** Rebuild tiny synthetic, credential-free format fixtures. */
import { Database } from "bun:sqlite";
import { writeArrayBuffer } from "geotiff";
import * as wkx from "wkx";
const root = new URL("../test/fixtures/", import.meta.url);
const db = new Database(":memory:");
db.exec(`PRAGMA application_id=1196444487;
CREATE TABLE gpkg_geometry_columns(table_name TEXT,column_name TEXT,geometry_type_name TEXT,srs_id INTEGER);
INSERT INTO gpkg_geometry_columns VALUES ('range','geom','MULTIPOLYGON',4326);
CREATE TABLE "range" (fid INTEGER PRIMARY KEY,geom BLOB,species_code TEXT,scientific_name TEXT,common_name TEXT,prediction_year INTEGER,type TEXT,season TEXT,start_date TEXT,end_date TEXT);`);
for (const [season,start,end,wkt] of [
  ["breeding","2023-05-17","2023-08-16","POLYGON((0 0,2 0,2 2,0 2,0 0),(0.5 0.5,0.5 1,1 1,1 0.5,0.5 0.5))"],
  ["nonbreeding","2023-11-22","2023-03-08","MULTIPOLYGON(((-2 -2,0 -2,0 0,-2 0,-2 -2)))"],
]) {
  const header=Buffer.alloc(8);header.write("GP");header[3]=1;header.writeInt32LE(4326,4);
  const geom=Buffer.concat([header,wkx.Geometry.parse(wkt as string).toWkb()]);
  db.query('INSERT INTO "range"(geom,species_code,scientific_name,common_name,prediction_year,type,season,start_date,end_date) VALUES (?,?,?,?,?,?,?,?,?)').run(geom,"mallar3","Anas platyrhynchos","Mallard",2023,"range",season as string,start as string,end as string);
}
await Bun.write(new URL("migration.gpkg",root),db.serialize());db.close();
const nodata=-9999;
const bands=[[0,2,nodata,4,nodata,6],[1,3,5,7,9,11],Array(6).fill(nodata)];
const values=new Float32Array(Array.from({length:6},(_,cell)=>bands.map(b=>b[cell] as number)).flat());
const tiff=writeArrayBuffer(values,{
  width:3,height:2,BitsPerSample:[32,32,32],SampleFormat:[3,3,3],SamplesPerPixel:3,
  ModelPixelScale:[27000,27000,0],ModelTiepoint:[0,0,0,0,54000,0],
  GTModelTypeGeoKey:1,GTRasterTypeGeoKey:1,ProjectedCSTypeGeoKey:8857,ProjLinearUnitsGeoKey:9001,
  GDAL_NODATA:String(nodata),
});
await Bun.write(new URL("migration.tif",root),tiff);
await Bun.write(new URL("band-dates.csv",root),"band,date\n1,2023-01-04\n2,2023-01-11\n3,2023-01-18\n");
