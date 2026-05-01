WITH seed(id, kind, family, hose_kind, primary_text, secondary, meta, note, data, sort_order) AS (
  VALUES
  ('thread-g-212','thread','g',NULL,'G2-1/2','G 管螺纹','75.184 mm / 11 TPI','BSPP 直管螺纹 · 2寸半大型管路接口','{"family":"g","familyLabel":"G 管螺纹","size":"G2-1/2","majorMm":75.184,"tpi":11,"seal":"直管螺纹","note":"2寸半大型管路接口"}'::jsonb,295),
  ('thread-g-5','thread','g',NULL,'G5','G 管螺纹','138.43 mm / 11 TPI','BSPP 直管螺纹 · 5寸大型管路接口','{"family":"g","familyLabel":"G 管螺纹","size":"G5","majorMm":138.43,"tpi":11,"seal":"直管螺纹","note":"5寸大型管路接口"}'::jsonb,312),
  ('thread-g-6','thread','g',NULL,'G6','G 管螺纹','163.83 mm / 11 TPI','BSPP 直管螺纹 · 6寸大型管路接口','{"family":"g","familyLabel":"G 管螺纹","size":"G6","majorMm":163.83,"tpi":11,"seal":"直管螺纹","note":"6寸大型管路接口"}'::jsonb,314),

  ('thread-r-114','thread','r',NULL,'R1-1/4 / Rc1-1/4 / PT1-1/4 / ZG1-1/4','R/Rc/PT/ZG','41.91 mm / 11 TPI','锥管螺纹 · 55°牙型角，1:16锥度','{"family":"r","familyLabel":"R/Rc/PT/ZG","size":"R1-1/4 / Rc1-1/4 / PT1-1/4 / ZG1-1/4","majorMm":41.91,"tpi":11,"seal":"锥管螺纹","note":"55°牙型角，1:16锥度"}'::jsonb,365),
  ('thread-r-112','thread','r',NULL,'R1-1/2 / Rc1-1/2 / PT1-1/2 / ZG1-1/2','R/Rc/PT/ZG','47.803 mm / 11 TPI','锥管螺纹 · 55°牙型角，1:16锥度','{"family":"r","familyLabel":"R/Rc/PT/ZG","size":"R1-1/2 / Rc1-1/2 / PT1-1/2 / ZG1-1/2","majorMm":47.803,"tpi":11,"seal":"锥管螺纹","note":"55°牙型角，1:16锥度"}'::jsonb,370),
  ('thread-r-212','thread','r',NULL,'R2-1/2 / Rc2-1/2 / PT2-1/2 / ZG2-1/2','R/Rc/PT/ZG','75.184 mm / 11 TPI','锥管螺纹 · 55°牙型角，1:16锥度','{"family":"r","familyLabel":"R/Rc/PT/ZG","size":"R2-1/2 / Rc2-1/2 / PT2-1/2 / ZG2-1/2","majorMm":75.184,"tpi":11,"seal":"锥管螺纹","note":"55°牙型角，1:16锥度"}'::jsonb,385),
  ('thread-r-4','thread','r',NULL,'R4 / Rc4 / PT4 / ZG4','R/Rc/PT/ZG','113.03 mm / 11 TPI','锥管螺纹 · 55°牙型角，1:16锥度','{"family":"r","familyLabel":"R/Rc/PT/ZG","size":"R4 / Rc4 / PT4 / ZG4","majorMm":113.03,"tpi":11,"seal":"锥管螺纹","note":"55°牙型角，1:16锥度"}'::jsonb,395),
  ('thread-r-5','thread','r',NULL,'R5 / Rc5 / PT5 / ZG5','R/Rc/PT/ZG','138.43 mm / 11 TPI','锥管螺纹 · 55°牙型角，1:16锥度','{"family":"r","familyLabel":"R/Rc/PT/ZG","size":"R5 / Rc5 / PT5 / ZG5","majorMm":138.43,"tpi":11,"seal":"锥管螺纹","note":"55°牙型角，1:16锥度"}'::jsonb,400),
  ('thread-r-6','thread','r',NULL,'R6 / Rc6 / PT6 / ZG6','R/Rc/PT/ZG','163.83 mm / 11 TPI','锥管螺纹 · 55°牙型角，1:16锥度','{"family":"r","familyLabel":"R/Rc/PT/ZG","size":"R6 / Rc6 / PT6 / ZG6","majorMm":163.83,"tpi":11,"seal":"锥管螺纹","note":"55°牙型角，1:16锥度"}'::jsonb,405),

  ('thread-npt-114','thread','npt',NULL,'NPT1-1/4','NPT 美制','42.164 mm / 11.5 TPI','美制锥管螺纹 · 60°牙型角，1:16锥度','{"family":"npt","familyLabel":"NPT 美制","size":"NPT1-1/4","majorMm":42.164,"tpi":11.5,"seal":"锥管螺纹","note":"60°牙型角，1:16锥度"}'::jsonb,465),
  ('thread-npt-112','thread','npt',NULL,'NPT1-1/2','NPT 美制','48.26 mm / 11.5 TPI','美制锥管螺纹 · 60°牙型角，1:16锥度','{"family":"npt","familyLabel":"NPT 美制","size":"NPT1-1/2","majorMm":48.26,"tpi":11.5,"seal":"锥管螺纹","note":"60°牙型角，1:16锥度"}'::jsonb,470),
  ('thread-npt-212','thread','npt',NULL,'NPT2-1/2','NPT 美制','73.025 mm / 8 TPI','美制锥管螺纹 · 60°牙型角，1:16锥度','{"family":"npt","familyLabel":"NPT 美制","size":"NPT2-1/2","majorMm":73.025,"tpi":8,"seal":"锥管螺纹","note":"60°牙型角，1:16锥度"}'::jsonb,485),
  ('thread-npt-3','thread','npt',NULL,'NPT3','NPT 美制','88.9 mm / 8 TPI','美制锥管螺纹 · 60°牙型角，1:16锥度','{"family":"npt","familyLabel":"NPT 美制","size":"NPT3","majorMm":88.9,"tpi":8,"seal":"锥管螺纹","note":"60°牙型角，1:16锥度"}'::jsonb,490),
  ('thread-npt-4','thread','npt',NULL,'NPT4','NPT 美制','114.3 mm / 8 TPI','美制锥管螺纹 · 60°牙型角，1:16锥度','{"family":"npt","familyLabel":"NPT 美制","size":"NPT4","majorMm":114.3,"tpi":8,"seal":"锥管螺纹","note":"60°牙型角，1:16锥度"}'::jsonb,495),
  ('thread-npt-5','thread','npt',NULL,'NPT5','NPT 美制','141.3 mm / 8 TPI','美制锥管螺纹 · 60°牙型角，1:16锥度','{"family":"npt","familyLabel":"NPT 美制","size":"NPT5","majorMm":141.3,"tpi":8,"seal":"锥管螺纹","note":"60°牙型角，1:16锥度"}'::jsonb,500),
  ('thread-npt-6','thread','npt',NULL,'NPT6','NPT 美制','168.275 mm / 8 TPI','美制锥管螺纹 · 60°牙型角，1:16锥度','{"family":"npt","familyLabel":"NPT 美制","size":"NPT6","majorMm":168.275,"tpi":8,"seal":"锥管螺纹","note":"60°牙型角，1:16锥度"}'::jsonb,505),

  ('pipe-dn125','pipe',NULL,NULL,'DN125','5"','外径 139.7 mm','5寸大型主管、设备总管','{"dn":"DN125","inch":"5","odMm":139.7,"commonUse":"5寸大型主管、设备总管"}'::jsonb,10100),
  ('pipe-dn200','pipe',NULL,NULL,'DN200','8"','外径 219.1 mm','大型工艺管线','{"dn":"DN200","inch":"8","odMm":219.1,"commonUse":"大型工艺管线"}'::jsonb,10120),

  ('hose-20','hose',NULL,'hydraulic','-20','液压油管','内径 31.8 mm / 6-14 MPa','1-1/4 · JIC-20 1-5/8-12 · 大流量回油/低压管路','{"dash":"-20","nominalInch":"1-1/4","innerMm":31.8,"outerRangeMm":"44-54","pressureMpa":"6-14","jic":"JIC-20 1-5/8-12","commonUse":"大流量回油/低压管路"}'::jsonb,20200),
  ('hose-24','hose',NULL,'hydraulic','-24','液压油管','内径 38.1 mm / 5-12 MPa','1-1/2 · JIC-24 1-7/8-12 · 大流量低压/回油管路','{"dash":"-24","nominalInch":"1-1/2","innerMm":38.1,"outerRangeMm":"52-62","pressureMpa":"5-12","jic":"JIC-24 1-7/8-12","commonUse":"大流量低压/回油管路"}'::jsonb,20240),
  ('hose-32','hose',NULL,'hydraulic','-32','液压油管','内径 50.8 mm / 4-10 MPa','2 · JIC-32 2-1/2-12 · 大通径低压/吸回油管路','{"dash":"-32","nominalInch":"2","innerMm":50.8,"outerRangeMm":"66-80","pressureMpa":"4-10","jic":"JIC-32 2-1/2-12","commonUse":"大通径低压/吸回油管路"}'::jsonb,20320),
  ('hose-40','hose',NULL,'hydraulic','-40','液压油管','内径 63.5 mm / 3-8 MPa','2-1/2 · 法兰/大通径接头 · 大型吸油/回油管路','{"dash":"-40","nominalInch":"2-1/2","innerMm":63.5,"outerRangeMm":"82-98","pressureMpa":"3-8","jic":"法兰/大通径接头","commonUse":"大型吸油/回油管路"}'::jsonb,20400),
  ('hose-48','hose',NULL,'hydraulic','-48','液压油管','内径 76.2 mm / 2-6 MPa','3 · 法兰/大通径接头 · 大型低压输送、吸回油管路','{"dash":"-48","nominalInch":"3","innerMm":76.2,"outerRangeMm":"96-116","pressureMpa":"2-6","jic":"法兰/大通径接头","commonUse":"大型低压输送、吸回油管路"}'::jsonb,20480)
)
INSERT INTO "thread_size_entries" ("id", "kind", "family", "hose_kind", "primary", "secondary", "meta", "note", "data", "sort_order", "enabled", "updated_at")
SELECT id, kind, family, hose_kind, primary_text, secondary, meta, note, data, sort_order, true, NOW()
FROM seed
ON CONFLICT ("id") DO NOTHING;
