/* js/finanzas.js â€” mÃ³dulo extraÃ­do de index.html (mismo orden de carga).
 * El deploy estampa la versiÃ³n en el src del index para bustear la cachÃ©. */

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   FINANZAS â€” OPTIMIZADO v2
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

/* â”€â”€ Datos mensuales por aÃ±o (neto sin IVA) â”€â”€ */
const FIN_MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const FIN_VENTAS = {
  2022: [0,0,0,0,0,2600000,400000,800000,1400000,1400000,800000,1600000],
  2023: [1610100,1638504,3070827,4246782,1200532,2958445,2559724,3464269,2433360,954400,16789488,6235284],
  2024: [4255270,5013442,4343000,1267882,16071493,1591279,10946818,8886000,12445264,19130663,16001944,8471000],
  2025: [0,1382040,6025486,6460093,5152953,837600,2210780,19170355,8935134,8537317,13666039,1357000],
  2026: [180000,5734120,5179000,2391000,19977700,0,0,0,0,0,0,0]
};

/* â”€â”€ Facturas histÃ³ricas (muestra completa 2026) â”€â”€ */
const FIN_FACTURAS_BASE = [
  /* â”€ ENE 2026 â”€ */
  {year:'2026',mes:'01',nombre:'Jourdan Lucente',empresa:'â€”',item:'SINTRA',cant:1,valor:108000,canal:'CONTACTO',cat:'IMPRENTA',fact:'356',pago:128520,porCobrar:0},
  {year:'2026',mes:'01',nombre:'Jourdan Lucente',empresa:'â€”',item:'VINILO',cant:1,valor:87000,canal:'CONTACTO',cat:'IMPRENTA',fact:'356',pago:103530,porCobrar:0},
  {year:'2026',mes:'01',nombre:'Jourdan Lucente',empresa:'â€”',item:'DESPACHO',cant:1,valor:30000,canal:'CONTACTO',cat:'IMPRENTA',fact:'356',pago:35700,porCobrar:0},
  {year:'2026',mes:'01',nombre:'Jourdan Lucente',empresa:'â€”',item:'DESCUENTO',cant:1,valor:-45000,canal:'CONTACTO',cat:'IMPRENTA',fact:'356',pago:-53550,porCobrar:0},
  /* â”€ FEB 2026 â”€ */
  {year:'2026',mes:'02',nombre:'Marco Pulgar',empresa:'LifeFitness',item:'DISEÃ‘O 3D (10 modelos)',cant:10,valor:94000,canal:'CONTACTO',cat:'3D',fact:'357',pago:535500,porCobrar:69200},
  {year:'2026',mes:'02',nombre:'Julio Miranda',empresa:'Comercial TSA SPA',item:'TROFEO',cant:2,valor:57000,canal:'CONTACTO',cat:'3D',fact:'358',pago:135660,porCobrar:0},
  {year:'2026',mes:'02',nombre:'Claudia Carvallo',empresa:'JardÃ­n Taruca',item:'AGENDAS ANILLADAS 122p',cant:100,valor:9000,canal:'CONTACTO',cat:'IMPRENTA',fact:'359',pago:1071000,porCobrar:0},
  {year:'2026',mes:'02',nombre:'Ignacio Besnier',empresa:'Graficas City Spa',item:'CARTEL NEON NIVEA 130Ã—90',cant:1,valor:500000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'360',pago:595000,porCobrar:0},
  {year:'2026',mes:'02',nombre:'Virginia Venturino',empresa:'BCI Pagos',item:'BOLSAS TNT',cant:2000,valor:1550,canal:'CONTACTO',cat:'IMPRENTA',fact:'361',pago:3689000,porCobrar:0},
  /* â”€ MAR 2026 â”€ */
  {year:'2026',mes:'03',nombre:'MarÃ­a JesÃºs Vergara',empresa:'CervecerÃ­a Chile SA',item:'TABLE TEND STELLA',cant:500,valor:7500,canal:'CONTACTO',cat:'IMPRENTA',fact:'366',pago:4462500,porCobrar:0},
  {year:'2026',mes:'03',nombre:'Ignacio Besnier',empresa:'Graficas City Spa',item:'PARIS Ã— LOLLA 210Ã—62',cant:1,valor:450000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'367',pago:535500,porCobrar:535500},
  {year:'2026',mes:'03',nombre:'Ignacio Besnier',empresa:'Graficas City Spa',item:'ISOTIPO MISTRAL 42cm Ã˜',cant:2,valor:70000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'365',pago:166600,porCobrar:0},
  {year:'2026',mes:'03',nombre:'Ignacio Besnier',empresa:'Graficas City Spa',item:'LOLLA Ã— MISTRAL 157Ã—31',cant:1,valor:360000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'368',pago:428400,porCobrar:0},
  {year:'2026',mes:'03',nombre:'Marcelo Cabrera',empresa:'BIG CUT SPA',item:'PAPEL MANTEQUILLA',cant:2000,valor:52,canal:'CONTACTO',cat:'IMPRENTA',fact:'369',pago:123760,porCobrar:0},
  /* â”€ ABR 2026 â”€ */
  {year:'2026',mes:'04',nombre:'Ignacio Besnier',empresa:'Graficas City Spa',item:'CARTEL NEON VANS',cant:2,valor:100000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'370',pago:238000,porCobrar:0},
  {year:'2026',mes:'04',nombre:'Keybin Gil Ramirez',empresa:'Impulso Creativo KD SPA',item:'FRASE NEON 110Ã—30',cant:1,valor:275000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'372',pago:327250,porCobrar:0},
  {year:'2026',mes:'04',nombre:'Keybin Gil Ramirez',empresa:'Impulso Creativo KD SPA',item:'FRANJAS NEON COLORES 200Ã—50',cant:1,valor:297000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'372',pago:353430,porCobrar:0},
  {year:'2026',mes:'04',nombre:'JoaquÃ­n Urrutia',empresa:'ART DESIGN SPA',item:'NEON MICHAEL',cant:1,valor:479000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'373',pago:570010,porCobrar:0},
  {year:'2026',mes:'04',nombre:'Nayareth Guerra',empresa:'DERMIK',item:'CARTEL 28Ã—18',cant:1,valor:50000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'374',pago:59500,porCobrar:0},
  {year:'2026',mes:'04',nombre:'Ignacio Besnier',empresa:'Graficas City Spa',item:'NEON NBY',cant:1,valor:300000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'375',pago:357000,porCobrar:0},
  {year:'2026',mes:'04',nombre:'Ignacio Besnier',empresa:'Graficas City Spa',item:'NEON RUN NIKE',cant:1,valor:300000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'376',pago:357000,porCobrar:0},
  {year:'2026',mes:'04',nombre:'JoaquÃ­n Urrutia',empresa:'ART DESIGN SPA',item:'NEON MIKO Ã— GAP',cant:1,valor:350000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'377',pago:416500,porCobrar:0},
  /* â”€ MAY 2026 â”€ */
  {year:'2026',mes:'05',nombre:'Virginia Venturino',empresa:'BCI Pagos',item:'CAJAS BCI 5/0',cant:2000,valor:3890,canal:'CONTACTO',cat:'IMPRENTA',fact:'378',pago:9258200,porCobrar:0},
  {year:'2026',mes:'05',nombre:'MarÃ­a JesÃºs Vergara',empresa:'CervecerÃ­a Chile SA',item:'TAP HANDLER QUILMES',cant:10,valor:72700,canal:'CONTACTO',cat:'IMPRENTA',fact:'380',pago:865130,porCobrar:0},
  {year:'2026',mes:'05',nombre:'MarÃ­a JesÃºs Vergara',empresa:'CervecerÃ­a Chile SA',item:'TABLE TENT QUILMES',cant:100,valor:6162,canal:'CONTACTO',cat:'IMPRENTA',fact:'',pago:733278,porCobrar:0},
 m«ëŒ+Š×®º+º$zzb¥â·–V#¢s##brÆÖW3¢sRrÆæöÖ'&S¢tg&æ6—66ò6öçF&FòrÆV×&W6¢t6öÖ—L:’FRÇF2FR6†–ÆRärârÆ—FVÓ¢tÄÄdU$òäd2rÆ6çC£3ÇfÆ÷#£SÆ6æÃ¢t4ôåD5DòrÆ6C¢tD•4\9òrÆf7C¢s3s’rÇvó£sƒSÇ÷$6ö'&#£ÒÀ¢·–V#¢s##brÆÖW3¢sRrÆæöÖ'&S¢tÖ,:Ö¦W<;§2fW&v&rÆV×&W6¢t6W'fV6W,:Ö6†–ÆR4rÆ—FVÓ¢uD$ÄRDTåBÔ”4„TÄô"rÆ6çC£CÇfÆ÷#£ƒrÆ6æÃ¢t4ôåD5DòrÆ6C¢t”Õ$TåDrÆf7C¢rrÇvó£Sc#Cƒ“"Ç÷$6ö'&#£ÒÀ¢·–V#¢s##brÆÖW3¢sRrÆæöÖ'&S¢tÖ,:Ö¦W<;§2fW&v&rÆV×&W6¢t6W'fV6W,:Ö6†–ÆR4rÆ—FVÓ¢t„”TÄU$Ô”4„TÄô"rÆ6çC£sÇfÆ÷#£ƒ#3“Æ6æÃ¢t4ôåD5DòrÆ6C¢t”Õ$TåDrÆf7C¢rrÇvó£cƒc3ƒrÇ÷$6ö'&#£ÒÀ¢·–V#¢s##brÆÖW3¢sRrÆæöÖ'&S¢t†—&vVæW&ÂfW&rÆV×&W6¢tW‡÷'FF÷&&–¶4rÆ—FVÓ¢tÄÄdU$õ2ÅD2rÆ6çC£3ÇfÆ÷#£SÆ6æÃ¢t4ôåD5DòrÆ6C¢tD•4\9òrÆf7C¢s3ƒ"rÇvó£sƒSÇ÷$6ö'&#£ÒÀ¢ò¢)H×VW7G&##R)H¢ğ¢·–V#¢s##RrÆÖW3¢s‚rÆæöÖ'&S¢tvöç¦Æò662rÆV×&W6¢t6öç7G'V7F÷&DÄ"rÆ—FVÓ¢tÕU4TòrÆ6çC£ÇfÆ÷#£3cCCƒRÆ6æÃ¢t4ôåD5DòrÆ6C¢u4U%d”4”òrÆf7C¢s3RrÇvó£C33#srÇ÷$6ö'&#£ÒÀ¢·–V#¢s##RrÆÖW3¢s‚rÆæöÖ'&S¢uf—&v–æ–fVçGW&–æòrÆV×&W6¢t$4’v÷2rÆ—FVÓ¢t4¤$4’"‡ƒ#’rÆ6çC£#ÇfÆ÷#£3ƒ“Æ6æÃ¢udTäDTDõ$U2rÆ6C¢t”Õ$TåDrÆf7C¢s3BrÇvó£“#Sƒ#Ç÷$6ö'&#£ÒÀ¢·–V#¢s##RrÆÖW3¢s’rÆæöÖ'&S¢tÖ,:Ö¦W<;§2fW&v&rÆV×&W6¢t6W'fV6W,:Ö6†–ÆR4rÆ—FVÓ¢uD$ÄRDTäB5DTÄÄrÆ6çC£ÇfÆ÷#£sÆ6æÃ¢t4ôåD5DòrÆ6C¢t”Õ$TåDrÆf7C¢s3’rÇvó£ƒCC“Ç÷$6ö'&#£ÒÀ¢·–V#¢s##RrÆÖW3¢srÆæöÖ'&S¢tÖ'L:Öâ6&ÆÆW&òrÆV×&W6¢uG&W2FVF÷2&öGV66–öæW2rÆ—FVÓ¢tÔ4UDU$ò4ôåD”äU"9s#SrÆ6çC£#SÇfÆ÷#£Æ6æÃ¢t4ôåD5DòrÆ6C¢t”Õ$TåDrÆf7C¢s33’rÇvó£3#s#SÇ÷$6ö'&#£ÒÀ¢·–V#¢s##RrÆÖW3¢srÆæöÖ'&S¢uf—&v–æ–fVçGW&–æòrÆV×&W6¢t$4’v÷2rÆ—FVÓ¢t$ôÅ42$4’Œ9s#’rÆ6çC£#ÇfÆ÷#£S3Æ6æÃ¢udTäDTDõ$U2rÆ6C¢t”Õ$TåDrÆf7C¢s3CRrÇvó£3cCCÇ÷$6ö'&#£ÒÀ¢·–V#¢s##RrÆÖW3¢srÆæöÖ'&S¢t—7&VÂ×\;÷¢rÆV×&W6¢t×VÇF–w&VÖ–Âæ6–öæÂrÆ—FVÓ¢u5DäBÕTÅD”u$TÔ”ÂrÆ6çC£ÇfÆ÷#£CC#Æ6æÃ¢t4ôåD5DòrÆ6C¢u4U%d”4”òrÆf7C¢s#C’rÇvó£S#S“ƒÇ÷$6ö'&#£ÒÀ¢·–V#¢s##RrÆÖW3¢srrÆæöÖ'&S¢t†ç266†Ö—G¢rÆV×&W6¢uDT4‚5E$TÒ5rÆ—FVÓ¢tÄô$U$9sSrÆ6çC£SÇfÆ÷#£#CsÆ6æÃ¢tEtõ$E2rÆ6C¢tD•4\9òrÆf7C¢s3BrÇvó£Cc“cSÇ÷$6ö'&#£ÒÀ¢·–V#¢s##RrÆÖW3¢s2rÆæöÖ'&S¢uf—&v–æ–fVçGW&–æòrÆV×&W6¢t$4’v÷2rÆ—FVÓ¢tD„U4•dòdU$”dôäRc#CÒ9scrÆ6çC£cÇfÆ÷#£c‚Æ6æÃ¢udTäDTDõ$U2rÆ6C¢t”Õ$TåDrÆf7C¢s#s‚rÇvó£C3C"Ç÷$6ö'&#£ÒÀ¢·–V#¢s##RrÆÖW3¢sbrÆæöÖ'&S¢u&–6&Fò¦÷'VW&rÆV×&W6¢tW&÷fçFvRrÆ—FVÓ¢tÄôtò²tT"²%$äD”ärrÆ6çC£ÇfÆ÷#£sscÆ6æÃ¢t4ôåD5DòrÆ6C¢tD•4\9òrÆf7C¢s#“brÇvó£ƒ3scÇ÷$6ö'&#£ÒÀ¢ò¢)H×VW7G&##B)H¢ğ¢·–V#¢s##BrÆÖW3¢sRrÆæöÖ'&S¢tg&æ6—66òF—GF&÷&ârÆV×&W6¢t–çfW'6–öæW2Æ2&÷62ÅDDârÆ—FVÓ¢tD•4\9ò’$TÔôDTÄ4œ94ârÆ6çC£ÇfÆ÷#£3ƒ33Æ6æÃ¢t4ôåD5DòrÆ6C¢u4U%d”4”òrÆf7C¢sCrrÇvó£cC#S“#rÇ÷$6ö'&#£ÒÀ¢·–V#¢s##BrÆÖW3¢srÆæöÖ'&S¢uf—&v–æ–fVçGW&–æòrÆV×&W6¢t$4’v÷2rÆ—FVÓ¢t4¤2$4’9s#rÆ6çC£#ÇfÆ÷#£33Æ6æÃ¢udTäDTDõ$U2rÆ6C¢t”Õ$TåDrÆf7C¢s#3"rÇvó£sƒSCÇ÷$6ö'&#£ÒÀ¢·–V#¢s##BrÆÖW3¢srÆæöÖ'&S¢tÇf&ò†–FÆvòrÆV×&W6¢tw'WòåE2rÆ—FVÓ¢t'F–7VÆFò&–ÆÇ’’Ö–¶R9sSrÆ6çC£SÇfÆ÷#£#Æ6æÃ¢t4ôåD5DòrÆ6C¢s4BrÆf7C¢srÇvó£sCÇ÷$6ö'&#£ÒÀ¢·–V#¢s##BrÆÖW3¢srÆæöÖ'&S¢uf—&v–æ–fVçGW&–æòrÆV×&W6¢t$4’v÷2rÆ—FVÓ¢t$ôÅ4DåB39sC9s"9s#rÆ6çC£#ÇfÆ÷#£SÆ6æÃ¢udTäDTDõ$U2rÆ6C¢t”Õ$TåDrÆf7C¢rrÇvó£3SsÇ÷$6ö'&#£ÒÀ¢·–V#¢s##BrÆÖW3¢s‚rÆæöÖ'&S¢uf—&v–æ–fVçGW&–æòrÆV×&W6¢t$4’v÷2rÆ—FVÓ¢t4¤2$4’9s#rÆ6çC£#ÇfÆ÷#£33Æ6æÃ¢udTäDTDõ$U2rÆ6C¢t”Õ$TåDrÆf7C¢sƒRrÇvó£sƒSCÇ÷$6ö'&#£ÒÀ¢·–V#¢s##BrÆÖW3¢srÆæöÖ'&S¢t—7&VÂ×\;÷¢rÆV×&W6¢t×VÇF–w&VÖ–Âæ6–öæÂrÆ—FVÓ¢u5DäBÕTÅD”u$TÔ”ÂrÆ6çC£ÇfÆ÷#£CC#Æ6æÃ¢t4ôåD5DòrÆ6C¢u4U%d”4”òrÆf7C¢s#C’rÇvó£S#S“ƒÇ÷$6ö'&#£ÒÀ¢ò¢)H×VW7G&##2)H¢ğ¢·–V#¢s##2rÆÖW3¢srÆæöÖ'&S¢uf—&v–æ–fVçGW&–æòrÆV×&W6¢t$4’v÷2rÆ—FVÓ¢t4¤$4’9s#rÆ6çC£#ÇfÆ÷#£3#SÆ6æÃ¢udTäDTDõ$U2rÆ6C¢t”Õ$TåDrÆf7C¢sbrÇvó£ss3SÇ÷$6ö'&#£ÒÀ¢·–V#¢s##2rÆÖW3¢srÆæöÖ'&S¢tÇf&ò†–FÆvòrÆV×&W6¢tw'WòåE2rÆ—FVÓ¢t'F–7VÆFò&–ÆÇ’’Ö–¶R9sSrÆ6çC£SÇfÆ÷#£#Æ6æÃ¢t4ôåD5DòrÆ6C¢s4BrÆf7C¢srÇvó£sCÇ÷$6ö'&#£ÒÀ¢·–V#¢s##2rÆÖW3¢sBrÆæöÖ'&S¢t†ç266†Ö—G¢rÆV×&W6¢uFV6‡7G&VÒrÆ—FVÓ¢tÆö&W&29sSrÆ6çC£SÇfÆ÷#£#SƒbÆ6æÃ¢t4ôåD5DòrÆ6C¢tD•4\9òrÆf7C¢sCrÇvó£S3ƒcsÇ÷$6ö'&#£ÒÀ¥Ó° ¢ò¢)H)H,:—7FÖ÷2)H)H¢ğ¦6öç7Bd”åõ$U5DÔõ2Ò°¢¶fV6†¢sRóó#brÇ&W7FÖó£#ÆFWföÇV6–öã¦çVÆÂÆFWVF£C“ƒS“BÆö'3¢rwÒÀ¢¶fV6†¢s#2óó#brÇ&W7FÖó£#ÆFWföÇV6–öã¦çVÆÂÆFWVF£SƒS“BÆö'3¢rwÒÀ¢¶fV6†¢s2ó"ó#brÇ&W7FÖó£#C““““ÆFWföÇV6–öã¦çVÆÂÆFWVF£scƒSƒ“BÆö'3¢tTÄTtôòwÒÀ¢¶fV6†¢s’ó"ó#brÇ&W7FÖó£3cƒ“ÆFWföÇV6–öã¦çVÆÂÆFWVF£3sCƒ“BÆö'3¢t$ôÅ42wÒÀ¢¶fV6†¢s#Bó"ó#brÇ&W7FÖó£#ÆFWföÇV6–öã¦çVÆÂÆFWVF£#SsCƒ“BÆö'3¢rwÒÀ¢¶fV6†¢sBó2ó#brÇ&W7FÖó£3c3cBÆFWföÇV6–öã¦çVÆÂÆFWVF£#“3c#S‚Æö'3¢rwÒÀ¢¶fV6†¢s2ó2ó#RrÇ&W7FÖó¦çVÆÂÆFWföÇV6–öã£SÆFWVF£C3c#S‚Æö'3¢tFWföÇV6œ;6âwÒÀ¢¶fV6†¢s2ó2ó#brÇ&W7FÖó£S“ƒÆFWföÇV6–öã¦çVÆÂÆFWVF£#“3s#3‚Æö'3¢s"TäDU"RÔ‚D$¤UDDR5,8”D•DòwÒÀ¢¶fV6†¢sbó2ó#brÇ&W7FÖó£S“ƒÆFWföÇV6–öã¦çVÆÂÆFWVF£CC3ƒ#‚Æö'3¢s"TäDU"RÔ‚D$¤UDDR5,8”D•DòwÒÀ¢¶fV6†¢s#ró2ó#brÇ&W7FÖó£3ÆFWföÇV6–öã¦çVÆÂÆFWVF£Cs3ƒ#‚Æö'3¢rwÒÀ¢¶fV6†¢sóBó#brÇ&W7FÖó£CÆFWföÇV6–öã¦çVÆÂÆFWVF£S3ƒ#‚Æö'3¢rwÒÀ¢¶fV6†¢s2óBó#brÇ&W7FÖó£#ÆFWföÇV6–öã¦çVÆÂÆFWVF£S33ƒ#‚Æö'3¢rwÒÀ¢¶fV6†¢s‚óBó#brÇ&W7FÖó£C3#ÆFWföÇV6–öã¦çVÆÂÆFWVF£“cSƒ#‚Æö'3¢u$tõ2DRd5EU$2wÒÀ¢¶fV6†¢s2óBó#brÇ&W7FÖó£#sSSsÆFWföÇV6–öã¦çVÆÂÆFWVF£““33sƒ’Æö'3¢scsC3wÒÀ¢¶fV6†¢sBóBó#brÇ&W7FÖó£ÆFWföÇV6–öã¦çVÆÂÆFWVF£#33sƒ’Æö'3¢rwÒÀ¢¶fV6†¢s#"óBó#brÇ&W7FÖó£#ÆFWföÇV6–öã¦çVÆÂÆFWVF£##33sƒ’Æö'3¢rwÒÀ¢¶fV6†¢s#BóBó#brÇ&W7FÖó£33sC3ÆFWföÇV6–öã¦çVÆÂÆFWVF£#Ss##Æö'3¢rwÒÀ¢¶fV6†¢sbóRó#brÇ&W7FÖó£SÆFWföÇV6–öã¦çVÆÂÆFWVF£#3s##Æö'3¢utõ2d5EU$2wÒÀ¥Ó° ¢ò¢)H)HW7FFòvÆö&Âf–æç¦2)H)H¢ğ¦ÆWBf–ä7W'&VçEF"Òw&W7VÖVâs°¦ÆWBf–äf7ErÒ°¦6öç7Bd”åõuõ4•¤RÒ#°¦ÆWBf–äf7Df–ÇG&F2ÒµÓ°¦ÆWBf–ä6†'D7F—fU–V"ÒvÆÂs° ¢ò¢)H)Hf÷&ÖFVF÷&W2)H)H¢ğ¦gVæ7F–öâ6Ç†â—°¢–b†ãÓÓÖçVÆÇÇÆãÓÓ×VæFVf–æVGÇÆãÓÓÒrr—&WGW&â~(	Bs°¢6öç7B'3ÔÖF‚æ'2„çVÖ&W"†â’“°¢6öç7Bf×CÒrBr¶'2çFôÆö6ÆU7G&–ær‚vW2Ô4Âr“°¢&WGW&âãÃòrÒr¶f×C¦f×C°§Ğ¦gVæ7F–öâ7B‡b—°¢–b‡cÓÓÖçVÆÇÇÇcÓÓ×VæFVf–æVB—&WGW&â~(	Bs°¢6öç7BãÔçVÖ&W"‡b“°¢6öç7B6Ç3ÖããÓòv&FvRÖw&VVâs¢v&FvR×&VBs°¢&WGW&âÇ7â6Æ73Ò&&FvRG¶6Ç7Ò#âG¶ããÓòr²s¢rwÒG¶âçFôf—†VBƒ—ÒSÂ÷7ãæ°§Ğ¦gVæ7F–öâf%7B†Æ"—¶–b‚ÇÂ"—&WGW&âçVÆÃ·&WGW&â‚†"Ö’ö’£·Ğ ¢ò¢)H)H7V"×F'2–çFW&æ÷2)H)H¢ğ¦gVæ7F–öâf–å7v—F6…F"‡F"—°¢f–ä7W'&VçEF#×F#°¢²w&W7VÖVârÂvf7GW&2rÂv6ö'&"rÂw&W7FÖ÷2rÂvFWVF2rÂvçVWfrÂvF–&–òrÂvv–ærrÂw&W7WVW7FòuÒæf÷$V6‚‡CÓç°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vf–â×æVÂÒr·B’ç7G–ÆRæF—7Æ“Ò‡CÓÓ×F"“òrs¢væöæRs°¢6öç7B'FãÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vf–âÖæbÒr·B“°¢–b†'Fâ—°¢'Fâæ6Æ74Æ—7BçFövvÆR‚v7F—fRÖf–ÇFW"rÇCÓÓ×F"“°¢Ğ¢Ò“°¢–b‡F#ÓÓÒw&W7VÖVâr—¶f–äG&t6†'B‚“¶f–äG&t6æÄFöçWB‚“¶f–å&VæFW%&W7VÖVäçVÂ‚“¶f–å&VæFW%F÷6Æ–VçFW2‚“·G'—·&VæFW$—fÖVç7VÂ‚“·Ö6F6‚†R—·×Ğ¢–b‡F#ÓÓÒvf7GW&2r—¶f–å&VæFW$f7GW&2‚“·Ğ¢–b‡F#ÓÓÒv6ö'&"r—¶f–å&VæFW$6ö'&"‚“·Ğ¢–b‡F#ÓÓÒw&W7FÖ÷2r—¶f–å&VæFW%&W7FÖ÷2‚“¶f–äG&tFWVFF–ÖVÆ–æR‚“·Ğ¢–b‡F#ÓÓÒvçVWfr—¶f–å&VæFW$çVWfÆ—7F‚“·Ğ¢–b‡F#ÓÓÒvF–&–òr—¶ÆD–æ—B‚“·Ğ¢–b‡F#ÓÓÒvv–ærr—¶f–å&VæFW$v–ær‚“·Ğ¢–b‡F#ÓÓÒw&W7WVW7Fòr—·&VæFW%&W7WVW7Fò‚“·Ğ§Ğ ¢ò¢)H)HF&ÆÖVç7VÂ6ö×&F—f)H)H¢ğ¦gVæ7F–öâf–å&VæFW$ÖVç7VÂ‚—°¢6öç7BF#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vf–äÖVç7VÄ&öG’r“°¢–b‚F"—&WGW&ã°¢6öç7BdÓÖf–åfVçF4ÖW&vVB‚“°¢6öç7BÖƒ#3ÔÖF‚æÖ‚‚ââådÕ³##5Ò“°¢6öç7BÖƒ#CÔÖF‚æÖ‚‚ââådÕ³##EÒ“°¢6öç7BÖƒ#SÔÖF‚æÖ‚‚ââådÕ³##UÒ“°¢6öç7BÖƒ#cÔÖF‚æÖ‚‚ââådÕ³##eÒ“°¢gVæ7F–öâ†VD&r‡bÆÖ…bÆÇ†—°¢–b‚gÇÂÖ…b—&WGW&ârs°¢6öç7B&F–ó×böÖ…c°¢6öç7B#ÔÖF‚ç&÷VæBƒ§&F–ò³3¢ƒ×&F–ò’“°¢6öç7BsÔÖF‚ç&÷VæBƒ#"§&F–ò³3¢ƒ×&F–ò’“°¢6öç7B#ÔÖF‚ç&÷VæBƒ#B§&F–ò³3¢ƒ×&F–ò’“°¢&WGW&â&6¶w&÷VæC§&v&‚G·'ÒÂG¶wÒÂG¶'ÒÂG¶Ç†§&F–òçFôf—†VBƒ"—Ò–°¢Ğ¢ÆWB‡FÖÃÒrs°¢d”åôÔU4U2æf÷$V6‚‚†ÒÆ’“Óç°¢6öç7Bc#3ÕdÕ³##5Õ¶•×ÇÃ°¢6öç7Bc#CÕdÕ³##EÕ¶•×ÇÃ°¢6öç7Bc#SÕdÕ³##UÕ¶•×ÇÃ°¢6öç7Bc#cÕdÕ³##eÕ¶•×ÇÃ°¢6öç7B#3#C×f%7B‡c#2Çc#B’Ç#C#S×f%7B‡c#BÇc#R’Ç#S#c×f%7B‡c#RÇc#b“°¢‡FÖÂ³ÖÇG#à¢ÇFB7G–ÆSÒ&föçB×vV–v‡C£c#âG¶×ÓÂ÷FCà¢ÇFB7G–ÆSÒ"G¶†VD&r‡c#2ÆÖƒ#2Ãã3R—Ò#âG·c#3ö6Ç‡c#2“¢~(	BwÓÂ÷FCà¢ÇFB7G–ÆSÒ"G¶†VD&r‡c#BÆÖƒ#BÃã3R—Ò#âG·c#Cö6Ç‡c#B“¢~(	BwÓÂ÷FCà¢ÇFCâG·#3#BÓÖçVÆÃ÷7B‡#3#B“¢~(	BwÓÂ÷FCà¢ÇFB7G–ÆSÒ"G¶†VD&r‡c#RÆÖƒ#RÃã3R—Ò#âG·c#Sö6Ç‡c#R“¢~(	BwÓÂ÷FCà¢ÇFCâG·#C#RÓÖçVÆÃ÷7B‡#C#R“¢~(	BwÓÂ÷FCà¢ÇFB7G–ÆSÒ"G¶†VD&r‡c#bÆÖƒ#bÃãB—Ó¶6öÆ÷#§f"‚ÒÖ66VçB“¶föçB×vV–v‡C£s#âG·c#cö6Ç‡c#b“¢~(	BwÓÂ÷FCà¢ÇFCâG²‡c#Rbgc#b“÷7B‡#S#b“¢~(	BwÓÂ÷FCà¢Â÷G#æ°¢Ò“°¢F"æ–ææW$…DÔÃÖ‡FÖÃ°§Ğ ¢ò¢)H)Hw,:f–6ò6çf2)H)H¢ğ¦gVæ7F–öâf–ä6†'E6WE–V"‡’—°¢f–ä6†'D7F—fU–V#×“°¢²vÆÂrÃ##2Ã##BÃ##RÃ##eÒæf÷$V6‚†³Óç°¢6öç7B'FãÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vf2Òr¶²“°¢–b†'Fâ–'Fâæ6Æ74Æ—7BçFövvÆR‚v'FâÖÖ–æ’×–VÆÆ÷rrÆ³ÓÓ×’“°¢Ò“°¢f–äG&t6†'B‚“°§Ğ¦gVæ7F–öâf–äG&t6†'B‚—°¢6öç7B6çf3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vf–åfVçF46†'Br“°¢–b‚6çf2—&WGW&ã°¢6öç7B7GƒÖ6çf2ævWD6öçFW‡B‚s&Br“°¢6öç7BsÖ6çf2æöfg6WEv–GF‡ÇÆ6çf2ç&VçDVÆVÖVçCòæ6Æ–VçEv–GF‡ÇÃc°¢6çf2çv–GFƒ×s°¢6çf2æ†V–v‡CÓ##°¢7G‚æ6ÆV%&V7BƒÃÇrÃ##“°¢6öç7B–V'3Öf–ä6†'D7F—fU–V#ÓÓÒvÆÂsõ³##2Ã##BÃ##RÃ##eÓ¥¶f–ä6†'D7F—fU–V%Ó°¢6öç7B6öÆ÷'3×³##3¢w&v&ƒcrÃ3’Ã#SÃã‚’rÃ##C¢w&v&ƒ#SRÃsÃÃã‚’rÃ##S¢w&v&ƒ#SRÃrÃS2Ãã‚’rÃ##c¢w&v&ƒÃ#"Ã#BÃã’’wÓ°¢6öç7BC×·C£#Ç#£Æ#£CÆÃ£cÓ°¢6öç7B6ƒÓ##×BçB×Bæ#°¢6öç7B7s×r×BæÂ×Bç#°¢òòÖ€¢6öç7BdÓÖf–åfVçF4ÖW&vVB‚“°¢ÆWBÖ…fÃÓ°¢–V'2æf÷$V6‚‡“ÓådÕ·•Òæf÷$V6‚‡cÓç¶–b‡cæÖ…fÂ–Ö…fÃ×c·Ò’“°¢–b‚Ö…fÂ–Ö…fÃÓ°¢6öç7B&%sÔÖF‚æÖ‚ƒBÄÖF‚æfÆö÷"‚†7ró"’÷–V'2æÆVæwF‚’Ó"“°¢6öç7Bw'sÖ7ró#°¢òòw&–BÆ–æW0¢7G‚ç7G&ö¶U7G–ÆSÒw&v&ƒ#SRÃ#SRÃ#SRÃãb’s¶7G‚æÆ–æUv–GFƒÓ°¢f÷"†ÆWB“Ó¶“ÃÓC¶’²²—°¢6öç7B“#×BçB¶6‚¢ƒÖ’óB“°¢7G‚æ&Vv–åF‚‚“¶7G‚æÖ÷fUFò‡BæÂÇ“"“¶7G‚æÆ–æUFò‡r×Bç"Ç“"“¶7G‚ç7G&ö¶R‚“°¢7G‚æf–ÆÅ7G–ÆSÒw&v&ƒ#SRÃ#SRÃ#SRÃã2’s¶7G‚æföçCÒs—‚DÒ6ç2s¶7G‚çFW‡DÆ–vãÒw&–v‡Bs°¢7G‚æf–ÆÅFW‡B†6Ç„ÖF‚ç&÷VæB†Ö…fÂ¦’óB’’ÇBæÂÓBÇ“"³2“°¢Ğ¢òò&'0¢–V'2æf÷$V6‚‚‡’Ç–’“Óç°¢dÕ·•Òæf÷$V6‚‚‡bÆÖ’“Óç°¢–b‚b—&WGW&ã°¢6öç7B&ƒÔÖF‚ç&÷VæB‚‡böÖ…fÂ’¦6‚“°¢6öç7Bƒ×BæÂ¶w'r¦Ö’²‡–’¢†&%r³"’’²†w'r×–V'2æÆVæwF‚¢†&%r³"’’ó#°¢6öç7B•÷3×BçB¶6‚Ö&ƒ°¢7G‚æf–ÆÅ7G–ÆSÖ6öÆ÷'5·•×ÇÂw&v&ƒÃ#"Ã#BÃã‚’s°¢7G‚æ&Vv–åF‚‚“¶7G‚ç&÷VæE&V7B‡‚Ç•÷2Æ&%rÆ&‚Ã"“¶7G‚æf–ÆÂ‚“°¢Ò“°¢Ò“°¢òòÖöçF‚Æ&VÇ0¢7G‚æf–ÆÅ7G–ÆSÒw&v&ƒ#SRÃ#SRÃ#SRÃãB’s¶7G‚æföçCÒs—‚DÒ6ç2s¶7G‚çFW‡DÆ–vãÒv6VçFW"s°¢d”åôÔU4U2æf÷$V6‚‚†ÒÆ’“Óç¶7G‚æf–ÆÅFW‡B†ÒÇBæÂ¶w'r¦’¶w'ró"Ã##×Bæ"³"“·Ò“°¢òòÆVvVæ@¢7G‚æföçCÒs‚DÒ6ç2s¶7G‚çFW‡DÆ–vãÒvÆVgBs°¢–V'2æf÷$V6‚‚‡’Æ’“Óç°¢7G‚æf–ÆÅ7G–ÆSÖ6öÆ÷'5·•Ó¶7G‚æf–ÆÅ&V7B‡BæÂ¶’£cÃbÃÃ‚“°¢7G‚æf–ÆÅ7G–ÆSÒw&v&ƒ#SRÃ#SRÃ#SRÃãb’s¶7G‚æf–ÆÅFW‡B‡’ÇBæÂ¶’£c³BÃB“°¢Ò“°§Ğ ¢ò¢)H)HF&ÆFRf7GW&2)H)H¢ğ¦gVæ7F–öâf–äf7GW&4g&öÔ—'F&ÆR‚—°¢&WGW&â7FFRæf7GW&0¢æf–ÇFW"‡#Óç"æf–VÆG5²uF÷FÂuÓãÇÇ"æf–VÆG5²tæWFòuÓã¢æÖ‡#Óç°¢6öç7Bc×"æf–VÆG3°¢6öç7BfV6†Öe²tfV6†u×ÇÂrs°¢6öç7B–V#ÖfV6†ç6Æ–6RƒÃB—ÇÅ7G&–ær†æWrFFR‚’ævWDgVÆÅ–V"‚’“°¢6öç7BÖW3Õ7G&–ær‡'6T–çB†fV6†ç6Æ–6RƒRÃr’—ÇÃ’çE7F'Bƒ"Âsr“°¢6öç7BæWFóÖe²tæWFòu×ÇÃ°¢6öç7B—fÖe²t•du×ÇÃ°¢6öç7BW†VçFóÖe²tW†VçFòu×ÇÃ°¢6öç7BF÷FÃÖe²uF÷FÂu×ÇÃ°¢6öç7B÷$6ö'&#Öe²tW7FFòvòuÓÓÓÒt6ö'&Fsó§F÷FÃ°¢&WGW&ç°¢–V"ÆÖW2À¢æöÖ'&S¦e²t6Æ–VçFRu×ÇÂ~(	BrÀ¢V×&W6¦e²t6Æ–VçFRu×ÇÂ~(	BrÀ¢—FVÓ¦e²uF—òEDRu×ÇÂtEDRrÀ¢6çC£À¢fÆ÷#¦æWF÷ÇÇF÷FÂÀ¢÷$6ö'&"À¢f7C¦e²tföÆ–òu×ÇÂrrÀ¢6æÃ¢tEDRrÀ¢6C¦e²tW7FFòvòu×ÇÂuVæF–VçFRrÀ¢öæWFó¦æWFòÅö—f¦—fÅöW†VçFó¦W†VçFòÅ÷F÷FÃ§F÷FÂÀ¢Ó°¢Ò“°§Ğ¦gVæ7F–öâf–ävWDÆÄf7GW&2‚—°¢ÆWBÆö6Ã·G'—¶Æö6ÃÔ¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ‚vf–å÷fVçF2r—ÇÂuµÒr“·Ö6F6‚†R—¶Æö6ÃÕµÓ·Ğ¢&WGW&â²ââäd”åôd5EU$5ô$4RÂââæÆö6ÂÂââæf–äf7GW&4g&öÔ—'F&ÆR‚•Ó°§Ğ¦gVæ7F–öâf–åfVçF4ÖW&vVB‚—°¢6öç7BÓ×·Ó°¢³##"Ã##2Ã##BÃ##RÃ##eÒæf÷$V6‚‡“Óç¶Õ·•ÓÕ²ââäd”åõdTåD5·•ÕÓ·Ò“°¢ÆWBögdÆö6Ã·G'—µögdÆö6ÃÔ¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ‚vf–å÷fVçF2r—ÇÂuµÒr“·Ö6F6‚†R—µögdÆö6ÃÕµÓ·Ğ¢ögdÆö6Âæf÷$V6‚‡#Óç°¢6öç7B“×'6T–çB‡"ç–V"Ã’ÆÖ“Ò‡'6T–çB‡"æÖW2Ã—ÇÃ’Ó°¢–b†Õ·•Ò–Õ·•Õ¶Ö•ÓÒ†Õ·•Õ¶Ö•×ÇÃ’·"çfÆ÷"§"æ6çC°¢Ò“°¢&WGW&âÓ°§Ğ¦gVæ7F–öâf–å&VæFW$f7GW&2‚—°¢6öç7B–V#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vf–âÖf–ÇG&ò×–V"r“òçfÇVWÇÂrs°¢6öç7BÖW3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vf–âÖf–ÇG&òÖÖW2r“òçfÇVWÇÂrs°¢6öç7B6æÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vf–âÖf–ÇG&òÖ6æÂr“òçfÇVWÇÂrs°¢6öç7B'W66#Ò†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vf–âÖf–ÇG&òÖ'W66"r“òçfÇVWÇÂrr’çFôÆ÷vW$66R‚“°¢ÆWBFFÖf–ävWDÆÄf7GW&2‚’æf–ÇFW"‡#Óç°¢–b‡–V"bg"ç–V"Ó×–V"—&WGW&âfÇ6S°¢–b†ÖW2bg"æÖW2ÓÖÖW2—&WGW&âfÇ6S°¢–b†6æÂbg"æ6æÂÓÖ6æÂ—&WGW&âfÇ6S°¢–b†'W66"bb‡"ææöÖ'&RçFôÆ÷vW$66R‚’æ–æ6ÇVFW2†'W66"—ÇÇ"æV×&W6çFôÆ÷vW$66R‚’æ–æ6ÇVFW2†'W66"—ÇÇ"æ—FVÒçFôÆ÷vW$66R‚’æ–æ6ÇVFW2†'W66"’’—&WGW&âfÇ6S°¢&WGW&âG'VS°¢Ò“°¢f–äf7Df–ÇG&F3ÖFF°¢f–äf7EsÓ°¢f–å&VæFW$f7GW&5vR‚“°§Ğ¦gVæ7F–öâf–å&VæFW$f7GW&5vR‚—°¢6öç7BFFÖf–äf7Df–ÇG&F3°¢6öç7BF÷FÃÖFFæÆVæwFƒ°¢6öç7BvW3ÔÖF‚æ6V–Â‡F÷FÂôd”åõuõ4•¤R—ÇÃ°¢6öç7B6Æ–6SÖFFç6Æ–6R†f–äf7Er¤d”åõuõ4•¤RÂ†f–äf7Er³’¤d”åõuõ4•¤R“°¢6öç7BÔU4U5ôeTÄÃÕ²tVæW&òrÂtfV'&W&òrÂtÖ'¦òrÂt'&–ÂrÂtÖ–òrÂt§Væ–òrÂt§VÆ–òrÂtv÷7FòrÂu6WF–VÖ'&RrÂtö7GV'&RrÂtæ÷f–VÖ'&RrÂtF–6–VÖ'&RuÓ°¢ÆWB‡FÖÃÒrrÇ7VÔæWFóÓÇ7VÔ—fÓÇ7VÕF÷FÃÓÇ7VÔ6ö'&#Ó°¢FFæf÷$V6‚‡#Óç°¢6öç7BæWFó×"åöæWFòÖçVÆÃ÷"åöæWFó§"çfÆ÷"§"æ6çC°¢6öç7B—f×"åö—fÖçVÆÃ÷"åö—f¤ÖF‚ç&÷VæB†æWFò£ã’“°¢6öç7BF÷C×"å÷F÷FÂÖçVÆÃ÷"å÷F÷FÃ¦æWFò¶—f°¢7VÔæWFò³ÖæWFó·7VÔ—f³Ö—f·7VÕF÷FÂ³×F÷C·7VÔ6ö'&"³×"ç÷$6ö'&'ÇÃ°¢Ò“°¢6Æ–6Ræf÷$V6‚‡#Óç°¢6öç7BæWFó×"åöæWFòÖçVÆÃ÷"åöæWFó§"çfÆ÷"§"æ6çC°¢6öç7B—f×"åö—fÖçVÆÃ÷"åö—f¤ÖF‚ç&÷VæB†æWFò£ã’“°¢6öç7BF÷C×"å÷F÷FÂÖçVÆÃ÷"å÷F÷FÃ¦æWFò¶—f°¢6öç7BÖW4æöÖ'&SÔÔU4U5ôeTÄÅ²‡'6T–çB‡"æÖW2Ã—ÇÃ’ÓÓ°¢6öç7B6æÄ&FvS×"æ6æÃÓÓÒtEtõ$E2sòv&FvR×–VÆÆ÷rs§"æ6æÃÓÓÒudTäDTDõ$U2sòv&FvRÖw&VVâs§"æ6æÃÓÓÒtEDRsòv&FvR×W'ÆRs¢v&FvRÖw&’s°¢‡FÖÂ³ÖÇG#à¢ÇFBFFÖÆ&VÃÒ$ÖW2ô;ò"7G–ÆSÒ'v†—FR×76S¦æ÷w&#âG¶ÖW4æöÖ'&WÒG·"ç–V'ÓÂ÷FCà¢ÇFBFFÖÆ&VÃÒ$6Æ–VçFR"7G–ÆSÒ&föçB×vV–v‡C£c·v†—FR×76S¦æ÷w&#âG·"ææöÖ'&WÓÂ÷FCà¢ÇFBFFÖÆ&VÃÒ$V×&W6"7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C"“¶föçB×6—¦S£‚#âG·"æV×&W6ÓÂ÷FCà¢ÇFBFFÖÆ&VÃÒ,8×FVÒ#âG·"æ—FV×ÓÂ÷FCà¢ÇFBFFÖÆ&VÃÒ$6çBâ"7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âG·"æ6çBçFôÆö6ÆU7G&–ær‚vW2Ô4Âr—ÓÂ÷FCà¢ÇFBFFÖÆ&VÃÒ%fÆ÷"Væ—Bâ"7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âG¶6Ç‡"çfÆ÷"—ÓÂ÷FCà¢ÇFBFFÖÆ&VÃÒ$æWFò"7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âG¶6Ç†æWFò—ÓÂ÷FCà¢ÇFBFFÖÆ&VÃÒ$•d"7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚Ò×FW‡C2’#âG¶6Ç†—f—ÓÂ÷FCà¢ÇFBFFÖÆ&VÃÒ%F÷FÂ´•d"7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖ66VçB’#âG¶6Ç‡F÷B—ÓÂ÷FCà¢ÇFBFFÖÆ&VÃÒ%÷"6ö'&""7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#¢G·"ç÷$6ö'&#ãòwf"‚ÒÖFævW"’s¢wf"‚ÒÖ66VçC2’wÒ#âG¶6Ç‡"ç÷$6ö'&"—ÓÂ÷FCà¢ÇFBFFÖÆ&VÃÒ$f7Bäì+"7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#âG·"æf7GÇÂ~(	BwÓÂ÷FCà¢ÇFBFFÖÆ&VÃÒ$6æÂ#ãÇ7â6Æ73Ò&&FvRG¶6æÄ&FvWÒ#âG·"æ6æÇÓÂ÷7ããÂ÷FCà¢ÇFBFFÖÆ&VÃÒ$6FVv÷,:Ö"7G–ÆSÒ&föçB×6—¦S£‚#âG·"æ6GÇÂ~(	BwÓÂ÷FCà¢Â÷G#æ°¢Ò“°¢–b‚6Æ–6RæÆVæwF‚–‡FÖÃÒsÇG#ãÇFB6öÇ7ãÒ#2"7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW#·FF–æs£3ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#å6–â&W7VÇFF÷3Â÷FCãÂ÷G#âs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vf–âÖf7GW&2Ö&öG’r’æ–ææW$…DÔÃÖ‡FÖÃ°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vf–âÖf7BÖ6÷VçBr’çFW‡D6öçFVçC×F÷FÂ²r&Vv—7G&÷2s°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vf–âÖf7B×F÷FÆW2r’çFW‡D6öçFVçCÖF÷FÆW2f–ÇG&F÷2(i"æWFó¢G¶6Ç‡7VÔæWFò—ÒÂ•d¢G¶6Ç‡7VÔ—f—ÒÂF÷FÃ¢G¶6Ç‡7VÕF÷FÂ—ÒÂ÷"6ö'&#¢G¶6Ç‡7VÔ6ö'&"—Ö°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vf–â×rÖ–æfòr’çFW‡D6öçFVçCÖG¶f–äf7Er³ÒòG·vW7Ö°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vf–â×r×&Wbr’æF—6&ÆVCÖf–äf7EsÓÓÓ°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vf–â×rÖæW‡Br’æF—6&ÆVCÖf–äf7Esã×vW2Ó°§Ğ¦gVæ7F–öâf–åu&Wb‚—¶–b†f–äf7Esã—¶f–äf7ErÒÓ¶f–å&VæFW$f7GW&5vR‚“·×Ğ¦gVæ7F–öâf–åtæW‡B‚—¶6öç7BvW3ÔÖF‚æ6V–Â†f–äf7Df–ÇG&F2æÆVæwF‚ôd”åõuõ4•¤R“¶–b†f–äf7EsÇvW2Ó—¶f–äf7Er²³¶f–å&VæFW$f7GW&5vR‚“·×Ğ ¢ò¢)H)H÷"6ö'&")H)H¢ğ¢òòÆ¦òFRvò÷"FVfV7Fò†6öæf–wW&&ÆR’(	B×V6†÷26Æ–VçFW2#$"Vâ6†–ÆR6öâ3ócó“L:Ö0¦gVæ7F–öâf–åÆ¦ôFVfVÇB‚—¶6öç7Bc×'6T–çB†Æö6Å7F÷&vRævWD—FVÒ‚vf–å÷Æ¦õöFVfVÇBr’“·&WGW&â‡cãbgcÃÓ3cR“÷c£3·Ğ¦gVæ7F–öâ6WDf–åÆ¦ôFVfVÇB‡b—¶6öç7Bã×'6T–çB‡b—ÇÃ3¶Æö6Å7F÷&vRç6WD—FVÒ‚vf–å÷Æ¦õöFVfVÇBrÄÖF‚æÖ‚ƒÄÖF‚æÖ–âƒ3cRÆâ’’“·G'—¶f–å&VæFW$6ö'&"‚“¶f–å&VæFW$v–ær‚“·Ö6F6‚†R—·×Ğ¢òòfVæ6–Ö–VçFò&VÂFRVæf7GW&¢W6fV6†W‡Ì:Ö6—FòÆ¦ò&÷–ò6’W†—7FVã²6’æòÂVÂÆ¦ò÷"FVfV7Fğ¦gVæ7F–öâf–åfVæ2‡"—°¢òòæ6Æ"ÖVF–æö6†RÄô4Â„6†–ÆR’âæWrFFR‚u•••’ÔÔÒÔDBr’6R'6V6öÖòUD2À¢òòVRVâ6†–ÆR…UD2ÓBòÓ2’6Rã#£FVÂL:ÖåDU$”õ#¢Æ÷2&L:Ö2FRÖ÷&"6P¢òòFVÆçF&âVâL:ÖGW&çFRÆF&FRöæö6†R†v–ær–æfÆFòÂ6ö'&ç¦vF–ÆÆF¢òòçFW2FRF–V×òÂ55bFW67VG&Fò’âVÂ&W7FòFVÂ&Wò–æ6Æ6öâuC££rà¢–b‡"bg"çfVæ2—¶6öç7BCÖæWrFFR…7G&–ær‡"çfVæ2’ç6Æ–6RƒÃ’²uC££r“¶–b‚—4æâ†B’—&WGW&âC·Ğ¢6öç7B&6SÖæWrFFR†G·"ç–V'ÒÒG·"æÖW7ÒÓC££’ævWEF–ÖR‚“°¢6öç7BÆ¦óÒ‡"bg"çÆ¦ôF–3ã“÷"çÆ¦ôF–3¦f–åÆ¦ôFVfVÇB‚“°¢&WGW&âæWrFFR†&6R·Æ¦ò£ƒcC“°§Ğ¦gVæ7F–öâf–å&VæFW$6ö'&"‚—°¢6öç7BFFÖf–ävWDÆÄf7GW&2‚’æf–ÇFW"‡#Óç"ç÷$6ö'&#ã“°¢6öç7BÔU4U5ôeTÄÃÕ²tVæW&òrÂtfV'&W&òrÂtÖ'¦òrÂt'&–ÂrÂtÖ–òrÂt§Væ–òrÂt§VÆ–òrÂtv÷7FòrÂu6WF–VÖ'&RrÂtö7GV'&RrÂtæ÷f–VÖ'&RrÂtF–6–VÖ'&RuÓ°¢6öç7B†÷“ÔFFRææ÷r‚“°¢òòv–ær'V6¶WG0¢6öç7B'V6¶WG3×¶#£Æ#3£Æ#c£Æ#“£Ó°¢ÆWB7VÕF÷FÃÓ°¢FFæf÷$V6‚‡#Óç°¢6öç7BF÷C×"å÷F÷FÂÖçVÆÃ÷"å÷F÷FÃ¢‡"çfÆ÷"§"æ6çB´ÖF‚ç&÷VæB‡"çfÆ÷"§"æ6çB£ã’’“°¢6öç7B6ö'&#×"ç÷$6ö'&'ÇÇF÷C°¢7VÕF÷FÂ³Ö6ö'&#°¢6öç7BfVæ3Öf–åfVæ2‡"“°¢6öç7BF–3ÔÖF‚æÖ‚ƒÄÖF‚æfÆö÷"‚††÷’×fVæ2ævWEF–ÖR‚’’óƒcC’“°¢–b†F–3ÃÓ3’'V6¶WG2æ#³Ö6ö'&#°¢VÇ6R–b†F–3ÃÓc’'V6¶WG2æ#3³Ö6ö'&#°¢VÇ6R–b†F–3ÃÓ“’'V6¶WG2æ#c³Ö6ö'&#°¢VÇ6R'V6¶WG2æ#“³Ö6ö'&#°¢Ò“° ¢òò&W7VÖVâv–æp¢òò&÷–V66œ;6âFR6¦FVÂÆ–'&òFRVF–F÷2Vâ7W'6ó¢çF–6—÷2÷6ÆF÷2;¦âæò6ö'&F÷2†F—7F–çFòFRf7GW&2VÖ—F–F2¢6öç7B÷VD7W'6óÒ‡7FFRçVF–F÷7ÇÅµÒ’æf–ÇFW"‡Óâ²tFW76†FòrÂt6ö×ÆWFFòrÂt6æ6VÆFòuÒæ–æ6ÇVFW2‡æf–VÆG5²tW7FFòVF–Fòu×ÇÂrr’“°¢6öç7B&÷•VF–F÷3Õ÷VD7W'6òç&VGV6R‚‡2Ç“Óç¶6öç7Bc×æf–VÆG2ÆæWFóÒ†e²tÖöçFòF÷FÂ„4Å’u×ÇÃ’óã“¶ÆWB#Ó¶–b‚e²tçF–6—òvFòƒSR’uÒ—"³ÖæWFò£ãS¶–b‚e²u6ÆFòvFòƒSR’uÒ—"³ÖæWFò£ãS·&WGW&â2·#·ÒÃ“°¢6öç7Bå&÷“Õ÷VD7W'6òæf–ÇFW"‡Óç¶6öç7Bc×æf–VÆG3·&WGW&âe²tçF–6—òvFòƒSR’u×ÇÂe²u6ÆFòvFòƒSR’uÓ·Ò’æÆVæwFƒ°¢6öç7Bv–ætVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vf–âÖ6ö'&"Öv–ærr“°¢–b†v–ætVÂ—°¢v–ætVÂæ–ææW$…DÔÃÒ†FFæÆVæwFƒö ¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£‡ƒ¶fÆW‚×w&§w&¶Ö&v–âÖ&÷GFöÓ£'‚#à¢ÆF—b6Æ73Ò&f2Ö·’"7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£ƒ‚#ãÇ7â6Æ73Ò&f2Ö·’ÖÆ&Â#åF÷FÂ6ö'&#Â÷7ããÇ7â6Æ73Ò&f2Ö·’×fÂ"7G–ÆSÒ&6öÆ÷#§f"‚ÒÖFævW"’#âG¶6Ç‡7VÕF÷FÂ—ÓÂ÷7ããÂöF—cà¢ÆF—b6Æ73Ò&f2Ö·’"7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£ƒ‚#ãÇ7â6Æ73Ò&f2Ö·’ÖÆ&Â#ã(	33L:Ö3Â÷7ããÇ7â6Æ73Ò&f2Ö·’×fÂ"7G–ÆSÒ&6öÆ÷#§f"‚Ò×v&â’#âG¶6Ç†'V6¶WG2æ#—ÓÂ÷7ããÂöF—cà¢ÆF—b6Æ73Ò&f2Ö·’"7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£ƒ‚#ãÇ7â6Æ73Ò&f2Ö·’ÖÆ&Â#ã3(	3cL:Ö3Â÷7ããÇ7â6Æ73Ò&f2Ö·’×fÂ"7G–ÆSÒ&6öÆ÷#§f"‚Ò×v&â’#âG¶6Ç†'V6¶WG2æ#3—ÓÂ÷7ããÂöF—cà¢ÆF—b6Æ73Ò&f2Ö·’"7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£ƒ‚#ãÇ7â6Æ73Ò&f2Ö·’ÖÆ&Â#ãc(	3“L:Ö3Â÷7ããÇ7â6Æ73Ò&f2Ö·’×fÂ"7G–ÆSÒ&6öÆ÷#§f"‚ÒÖFævW"’#âG¶6Ç†'V6¶WG2æ#c—ÓÂ÷7ããÂöF—cà¢ÆF—b6Æ73Ò&f2Ö·’f2Ö·’ÖFævW""7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£ƒ‚#ãÇ7â6Æ73Ò&f2Ö·’ÖÆ&Â#âfwC³“L:Ö3Â÷7ããÇ7â6Æ73Ò&f2Ö·’×fÂ#âG¶6Ç†'V6¶WG2æ#“—ÓÂ÷7ããÂöF—cà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£wƒ¶Ö&v–âÖ&÷GFöÓ£'ƒ¶föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#à¢Ç7ãåÆ¦òFRvòW7L:æF#£Â÷7ãà¢Æ–çWBG—SÒ&çVÖ&W""Ö–ãÒ#"ÖƒÒ#3cR"fÇVSÒ"G¶f–åÆ¦ôFVfVÇB‚—Ò"öæ6†ævSÒ'6WDf–åÆ¦ôFVfVÇB‡F†—2çfÇVR’"7G–ÆSÒ'v–GFƒ£cƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£gƒ·FF–æs£7‚wƒ¶6öÆ÷#§f"‚Ò×FW‡B“¶föçB×6—¦S£ƒ·FW‡BÖÆ–vã¦6VçFW"#âL:Ö0¢Ç7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2’"F—FÆSÒ$ÆÖ÷&6R6Æ7VÆFW6FRVÂfVæ6–Ö–VçFò†–æ–6–òFRÖW2FRÆf7GW&²W7FRÆ¦ò’âÆ2f7GW&26öâfV6†òÆ¦ò&÷–òW6âVÂ7W–òâ#î)9ƒÂ÷7ãà¢ÂöF—cæ¢rr’²‡&÷•VF–F÷3ãö ¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£‡ƒ¶Ö&v–âÖ&÷GFöÓ£'ƒ·FF–æs£—‚'ƒ¶&6¶w&÷VæC§&v&ƒÃ#"ÃsÃãb“¶&÷&FW#£‚6öÆ–B&v&ƒÃ#"ÃsÃã#"“¶&÷&FW"×&F—W3£‡ƒ¶föçB×6—¦S£‚#à¢Ç7â7G–ÆSÒ&föçB×6—¦S£G‚#ï	ù:SÂ÷7ãà¢Ç7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C"’#å÷"VçG&"FRÆ#çVF–F÷2Vâ7W'6óÂö#â†çF–6—÷2÷6ÆF÷2VæF–VçFW2ÂæWFò“¢Æ"7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ66VçC2’#âG¶6Ç‡&÷•VF–F÷2—ÓÂö#â+rG¶å&÷—ÒVF–FòG¶å&÷’ÓÓòw2s¢rwÓÂ÷7ãà¢Ç7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2’"F—FÆSÒ%&÷–V66œ;6âFR6¦FVÂÆ–'&òFRVF–F÷27F—f÷2†æòFW76†F÷2æ’6æ6VÆF÷2“¢7VÖÆ÷2SRFRçF–6—ò’6ÆFò;¦âæòÖ&6F÷26öÖòvF÷2âW2F—7F–çFòFRÆ2f7GW&2VÖ—F–F2FR'&–&â#î)9ƒÂ÷7ãà¢ÂöF—cæ¢rr“°¢Ğ ¢òòÖ÷&÷"f7GW&²÷&FVâ÷"W&vVæ6–†Ü:2Ö÷&÷6&–ÖW&ò¢6öç7B÷&FVæF3ÖFFæÖ‡#Óç°¢6öç7BF–3ÔÖF‚æÖ‚ƒÄÖF‚æfÆö÷"‚††÷’Öf–åfVæ2‡"’ævWEF–ÖR‚’’óƒcC’“°¢&WGW&ç²ââç"ÅöF–3¦F–7Ó°¢Ò’ç6÷'B‚†Æ"“Óæ"åöF–2ÖåöF–7ÇÂ†"ç÷$6ö'&'ÇÃ’Ò†ç÷$6ö'&'ÇÃ’“°¢ÆWB‡FÖÃÒrs°¢÷&FVæF2æf÷$V6‚‡#Óç°¢6öç7BF÷C×"å÷F÷FÂÖçVÆÃ÷"å÷F÷FÃ¢‡"çfÆ÷"§"æ6çB´ÖF‚ç&÷VæB‡"çfÆ÷"§"æ6çB£ã’’“°¢6öç7B6ö'&#×"ç÷$6ö'&'ÇÇF÷C°¢6öç7BÖW4æöÖ'&SÔÔU4U5ôeTÄÅ²‡'6T–çB‡"æÖW2Ã—ÇÃ’ÓÓ°¢6öç7BC×"åöF–3¶6öç7BÖ6öÃÖCã“òwf"‚ÒÖFævW"’s¦Cã3òwf"‚Ò×v&â’s¢wf"‚Ò×FW‡C2’s°¢6öç7BÖÆ&ÃÖCÃÓò~(	Bs¦G¶GÖF°¢‡FÖÂ³ÖÇG#à¢ÇFBFFÖÆ&VÃÒ$ÖW2#âG¶ÖW4æöÖ'&WÒG·"ç–V'ÓÂ÷FCà¢ÇFBFFÖÆ&VÃÒ$6Æ–VçFR"7G–ÆSÒ&föçB×vV–v‡C£c#âG·"ææöÖ'&WÓÂ÷FCà¢ÇFBFFÖÆ&VÃÒ$V×&W6#âG·"æV×&W6ÓÂ÷FCà¢ÇFBFFÖÆ&VÃÒ,8×FVÒ#âG·"æ—FV×ÓÂ÷FCà¢ÇFBFFÖÆ&VÃÒ%F÷FÂ´•d"7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âG¶6Ç‡F÷B—ÓÂ÷FCà¢ÇFBFFÖÆ&VÃÒ%÷"6ö'&""7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚ÒÖFævW"“¶föçB×vV–v‡C£s#âG¶6Ç†6ö'&"—ÓÂ÷FCà¢ÇFBFFÖÆ&VÃÒ$Ö÷&"7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#¢G¶Ö6öÇÓ¶föçB×vV–v‡C£c#âG¶ÖÆ&ÇÓÂ÷FCà¢ÇFBFFÖÆ&VÃÒ$f7Bäì+#âG·"æf7GÇÂ~(	BwÓÂ÷FCà¢Â÷G#æ°¢Ò“°¢–b‚‡FÖÂ–‡FÖÃÒsÇG#ãÇFB6öÇ7ãÒ#‚"7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW#·FF–æs£3ƒ¶6öÆ÷#§f"‚ÒÖ66VçC2’#î)É26–âf7GW&2VæF–VçFW2FR6ö'&ò&Vv—7G&F3Â÷FCãÂ÷G#âs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vf–âÖ6ö'&"Ö&öG’r’æ–ææW$…DÔÃÖ‡FÖÃ°¢G'—¶f–å&VæFW$6ö'&ç¦7F–öç2‚“·Ö6F6‚†R—·Ğ¢G'—¶f–å&VæFW$fÇV¦ô6¦‚“·Ö6F6‚†R—·Ğ§Ğ ¢ò¢)H)HdÅT¤òDR4¤$õ”T5DDò„ã’)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢&÷–V66œ;6â6VÖæÂ‚6VÖæ3¢–æw&W6÷2Òf7GW&2÷"6ö'& ¢V&–6F2VâÆ6VÖæFR7RfVæ6–Ö–VçFò†Æ2–fVæ6–F26VâVâÆ¢6VÖæ7GVÂÂ÷'VRVÂF–æW&ò(	Ç6RFV&W,:Ö6ö'&"–(	Ò“²Vw&W6÷2Ğ¢v÷2&öw&ÖF÷2VRVÂW7V&–ò–æw&W6†Æö6Å7F÷&vR’âVÂ6ÆFğ¢7V×VÆFò'&æ6FVÂ6ÆFò–æ–6–ÂFV6Æ&Fò’Væ6FVæ6VÖæ¢6VÖæ²Æ26VÖæ2FöæFRVVFVâ&ö¦ò6R&W6ÇFâ6öÖòÆW'Fâ¢ğ¦6öç7Bõtõ5õ$ôuô´U“ÒwF†VÆ%÷v÷5÷&öu÷cs°¦6öç7Bõ4ÄDõô”ä•ô´U“ÒwF†VÆ%÷6ÆFõö–æ–6–Å÷cs°¦gVæ7F–öâ÷v÷5&ör‚—·G'—·&WGW&â¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ…õtõ5õ$ôuô´U’—ÇÂuµÒr“·Ö6F6‚†R—·&WGW&åµÓ·×Ğ¦gVæ7F–öâ÷v÷5&öu6fR†'"—·G'—¶Æö6Å7F÷&vRç6WD—FVÒ…õtõ5õ$ôuô´U’Ä¥4ôâç7G&–æv–g’†''ÇÅµÒ’“·Ö6F6‚†R—·×Ğ¦gVæ7F–öâf–å6ÆFô–æ–6–Â‚—¶6öç7Bc×'6TfÆöB†Æö6Å7F÷&vRævWD—FVÒ…õ4ÄDõô”ä•ô´U’’“·&WGW&â—4æâ‡b“ó§c·Ğ¦gVæ7F–öâ6WDf–å6ÆFô–æ–6–Â‡b—¶6öç7Bã×'6TfÆöB‡b—ÇÃ¶Æö6Å7F÷&vRç6WD—FVÒ…õ4ÄDõô”ä•ô´U’Å7G&–ær†â’“·G'—¶f–å&VæFW$fÇV¦ô6¦‚“·Ö6F6‚†R—·×Ğ¢òò–æ–6–ò†ÇVæW2£’FRÆ6VÖæVR6öçF–VæRG0¦gVæ7F–öâ÷6VÖæ–æ–6–ò‡G2—¶6öç7BCÖæWrFFR‡G2“¶Bç6WD†÷W'2ƒÃÃÃ“¶6öç7BF÷sÒ†BævWDF’‚’³b’Ss²ò£ÖÇVæW2¢öBç6WDFFR†BævWDFFR‚’ÖF÷r“·&WGW&âBævWEF–ÖR‚“·Ğ¦gVæ7F–öâFEvõ&öw&ÖFò‚—°¢6öç7B6öæ6WFóÒ‡&ö×B‚t6öæ6WFòFVÂvò&öw&ÖFò†V£¢'&–VæFòÂ7VVÆF÷2Â&÷fVVF÷"f–ÆÖVçFò“¢r—ÇÂrr’çG&–Ò‚“°¢–b‚6öæ6WFò—&WGW&ã°¢6öç7BÖöçFõ&s×&ö×B‚tÖöçFòFVÂvò„4Å“¢rÂrr“¶–b†ÖöçFõ&sÓÖçVÆÂ—&WGW&ã°¢6öç7BÖöçFóÔÖF†Ú±î¸Â¸­yêë¢°k¢G§¦*^.round(parseFloat(String(montoRaw).replace(/[^\d.-]/g,''))||0);
  if(!(monto>0)){toast('Monto invÃ¡lido','error');return;}
  const hoyISO=hoyCL();
  const fecha=(prompt('Fecha del pago (AAAA-MM-DD):',hoyISO)||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(fecha)){toast('Fecha invÃ¡lida (usa AAAA-MM-DD)','error');return;}
  const recurrente=confirm('Â¿Es un pago mensual recurrente? (Aceptar = se repite cada mes en las 8 semanas; Cancelar = pago Ãºnico)');
  const arr=_pagosProg();
  arr.push({id:'pp'+_semanaInicio(Date.now())+'_'+arr.length+'_'+concepto.length,concepto,monto,fecha,recurrente:!!recurrente});
  _pagosProgSave(arr);
  toast('âœ“ Pago programado agregado','success');
  try{finRenderFlujoCaja();}catch(e){}
}
function delPagoProgramado(id){
  const arr=_pagosProg().filter(p=>p.id!==id);
  _pagosProgSave(arr);
  try{finRenderFlujoCaja();}catch(e){}
}
// Expande un pago recurrente a las ocurrencias que caen dentro del horizonte [ini,fin)
function _pagoOcurrencias(p,horizIni,horizFin){
  const base=new Date(p.fecha+'T00:00:00').getTime();
  if(isNaN(base))return[];
  if(!p.recurrente)return(base>=horizIni&&base<horizFin)?[base]:[];
  // El dÃ­a del mes en que cae el pago. Si el pago es "el 31" y el mes no tiene
  // 31 dÃ­as, cae el Ãºltimo dÃ­a de ese mes (arriendo/sueldos: pagas igual).
  const d0=new Date(p.fecha+'T00:00:00');
  const dia=d0.getDate();
  // Se recorre mes a mes con year/month explÃ­citos. Antes se avanzaba con
  // setMonth() sobre una fecha que ya tenÃ­a dÃ­a 31: al pasar a un mes mÃ¡s corto,
  // JS desborda al mes siguiente (feb 31 â†’ mar 3) y ESE mes se saltaba. Un pago
  // el dÃ­a 31 daba 4 ocurrencias en vez de 6, y en el dÃ­a equivocado â€”los
  // egresos salÃ­an subestimados y la caja se veÃ­a mÃ¡s sana de lo real.
  const finDate=new Date(horizFin);
  const out=[];
  let y=new Date(horizIni).getFullYear();
  let m=new Date(horizIni).getMonth()-1;   // arranca un mes antes por si el horizonte parte a mitad de mes
  for(let i=0;i<14;i++){                    // 8 semanas â‰ˆ 2-3 meses; 14 cubre de sobra sin poder colgarse
    const ultimo=new Date(y,m+1,0).getDate();          // Ãºltimo dÃ­a de ese mes
    const cand=new Date(y,m,Math.min(dia,ultimo)).getTime();
    if(cand>=horizIni&&cand<horizFin) out.push(cand);
    m++; if(m>11){m=0;y++;}
    if(new Date(y,m,1).getTime()>=finDate.getTime()+31*864e5) break;
  }
  return out;
}
function finRenderFlujoCaja(){
  const box=document.getElementById('finFlujoCaja'); if(!box) return;
  const SEMANAS=8;
  const semIni=_semanaInicio(Date.now());
  const horizIni=semIni, horizFin=semIni+SEMANAS*7*864e5;
  // Buckets semanales
  const weeks=[];for(let i=0;i<SEMANAS;i++){weeks.push({ini:semIni+i*7*864e5,ingreso:0,egreso:0,detIn:[],detEg:[]});}
  const bucketFor=ts=>{let idx=Math.floor((ts-semIni)/(7*864e5));if(idx<0)idx=0;if(idx>SEMANAS-1)return-1;return idx;};
  // Ingresos: facturas por cobrar, ubicadas por vencimiento (vencidas â†’ semana 0)
  const facturas=finGetAllFacturas().filter(r=>r.porCobrar>0);
  facturas.forEach(r=>{
    const venc=finVenc(r).getTime();
    const ts=venc<horizIni?horizIni:venc;   // vencidas/antiguas: se esperan cobrar ya
    const idx=bucketFor(ts); if(idx<0)return;   // vencimientos mÃ¡s allÃ¡ del horizonte quedan fuera
    weeks[idx].ingreso+=r.porCobrar;
    weeks[idx].detIn.push({nombre:(r.empresa&&r.empresa!=='â€”')?r.empresa:r.nombre,monto:r.porCobrar,vencido:venc<horizIni});
  });
  // Egresos: pagos programados (con recurrencia expandida)
  const pagos=_pagosProg();
  pagos.forEach(p=>{
    _pagoOcurrencias(p,horizIni,horizFin).forEach(ts=>{
      const idx=bucketFor(ts); if(idx<0)return;
      weeks[idx].egreso+=p.monto;
      weeks[idx].detEg.push({concepto:p.concepto,monto:p.monto,id:p.id,recurrente:p.recurrente});
    });
  });
  const totIn=weeks.reduce((s,w)=>s+w.ingreso,0), totEg=weeks.reduce((s,w)=>s+w.egreso,0);
  // Saldo acumulado
  let saldo=finSaldoInicial();let minSaldo=saldo,minWeek=-1;
  weeks.forEach((w,i)=>{saldo+=w.ingreso-w.egreso;w.saldo=saldo;if(saldo<minSaldo){minSaldo=saldo;minWeek=i;}});
  const fmtRango=w=>{const a=new Date(w.ini),b=new Date(w.ini+6*864e5);const mm=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];return `${a.getDate()} ${mm[a.getMonth()]}â€“${b.getDate()} ${mm[b.getMonth()]}`;};
  // KPIs
  let html=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
    <div class="fac-kpi" style="flex:1;min-width:90px"><span class="fac-kpi-lbl">Ingresos 8 sem.</span><span class="fac-kpi-val" style="color:var(--accent3)">${clp(totIn)}</span></div>
    <div class="fac-kpi" style="flex:1;min-width:90px"><span class="fac-kpi-lbl">Egresos 8 sem.</span><span class="fac-kpi-val" style="color:var(--danger)">${clp(totEg)}</span></div>
    <div class="fac-kpi" style="flex:1;min-width:90px"><span class="fac-kpi-lbl">Neto</span><span class="fac-kpi-val" style="color:${totIn-totEg>=0?'var(--accent3)':'var(--danger)'}">${clp(totIn-totEg)}</span></div>
    <div class="fac-kpi ${minSaldo<0?'fac-kpi-danger':''}" style="flex:1;min-width:90px"><span class="fac-kpi-lbl">Saldo mÃ­nimo</span><span class="fac-kpi-val" style="${minSaldo<0?'':'color:var(--text2)'}">${clp(minSaldo)}</span></div>
  </div>`;
  if(minWeek>=0&&minSaldo<0){
    html+=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:9px 12px;background:rgba(255,68,68,0.07);border:1px solid rgba(255,68,68,0.28);border-radius:8px;font-size:11.5px;color:var(--text2)">
      <span style="font-size:15px">âš ï¸</span><span>La caja quedarÃ­a <b style="color:var(--danger)">negativa</b> la semana del <b>${fmtRango(weeks[minWeek])}</b> (${clp(minSaldo)}). Adelanta cobros o reprograma egresos de esa semana.</span></div>`;
  }
  // Tabla semanal
  html+=`<div class="table-wrap"><table><thead><tr>
    <th>Semana</th><th style="text-align:right">Ingresos</th><th style="text-align:right">Egresos</th><th style="text-align:right">Neto</th><th style="text-align:right">Saldo acum.</th></tr></thead><tbody>`;
  weeks.forEach((w,i)=>{
    const neto=w.ingreso-w.egreso;const neg=w.saldo<0;
    const inTitle=w.detIn.length?w.detIn.slice(0,8).map(d=>`${d.nombre}: ${clp(d.monto)}${d.vencido?' (vencida)':''}`).join('\n'):'Sin ingresos esta semana';
    const egTitle=w.detEg.length?w.detEg.map(d=>`${d.concepto}: ${clp(d.monto)}`).join('\n'):'Sin egresos esta semana';
    html+=`<tr style="${neg?'background:rgba(255,68,68,0.05)':''}">
      <td data-label="Semana"${i===0?' style="font-weight:600"':''}>${fmtRango(w)}${i===0?' <span class="badge badge-gray" style="font-size:8px">actual</span>':''}</td>
      <td data-label="Ingresos" style="text-align:right;color:${w.ingreso?'var(--accent3)':'var(--text3)'}" title="${escapeHtml(inTitle)}">${w.ingreso?clp(w.ingreso):'â€”'}</td>
      <td data-label="Egresos" style="text-align:right;color:${w.egreso?'var(--danger)':'var(--text3)'}" title="${escapeHtml(egTitle)}">${w.egreso?'-'+clp(w.egreso):'â€”'}</td>
      <td data-label="Neto" style="text-align:right;color:${neto>=0?'var(--text2)':'var(--danger)'}">${clp(neto)}</td>
      <td data-label="Saldo acum." style="text-align:right;font-weight:700;color:${neg?'var(--danger)':'var(--accent3)'}">${clp(w.saldo)}</td>
    </tr>`;
  });
  html+=`</tbody></table></div>`;
  // Lista de pagos programados (para poder borrarlos)
  if(pagos.length){
    html+=`<div style="margin-top:12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--text3);padding:0 2px 6px">Pagos programados (${pagos.length})</div>
    <div style="display:flex;flex-direction:column;gap:5px">`+pagos.slice().sort((a,b)=>(a.fecha||'').localeCompare(b.fecha||'')).map(p=>`
      <div style="display:flex;align-items:center;gap:9px;padding:6px 10px;border:1px solid var(--border);border-radius:7px;font-size:11.5px">
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.concepto)}${p.recurrente?' <span class="badge badge-gray" style="font-size:8px">mensual</span>':''}</span>
        <span style="color:var(--text3);flex-shrink:0">${escapeHtml(p.fecha)}</span>
        <span style="color:var(--danger);font-weight:600;flex-shrink:0">-${clp(p.monto)}</span>
        <button class="btn btn-ghost btn-sm" style="flex-shrink:0;padding:2px 8px" data-id="${escapeHtml(p.id)}" onclick="delPagoProgramado(this.dataset.id)" title="Eliminar">âœ•</button>
      </div>`).join('')+`</div>`;
  }else{
    html+=`<div style="margin-top:10px;padding:10px 12px;font-size:11px;color:var(--text3);text-align:center;border:1px dashed var(--border2);border-radius:8px">Sin egresos programados. Usa <b>ï¼‹ Pago programado</b> para incluir arriendo, sueldos o proveedores y ver el saldo real proyectado.</div>`;
  }
  box.innerHTML=html;
  // Sincroniza el input de saldo inicial con lo guardado
  const si=document.getElementById('finSaldoInicial'); if(si&&document.activeElement!==si) si.value=finSaldoInicial();
}
// Exporta la cartera por cobrar (ordenada por mora) a CSV para trabajarla aparte o pasarla a cobranza
function finExportCobranza(){
  const data=finGetAllFacturas().filter(r=>r.porCobrar>0);
  if(!data.length){toast('No hay facturas pendientes de cobro','error');return;}
  const hoy=Date.now();const MESES=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const rows=data.map(r=>{const tot=r._total!=null?r._total:(r.valor*r.cant+Math.round(r.valor*r.cant*0.19));const cobrar=r.porCobrar||tot;const dias=Math.max(0,Math.floor((hoy-finVenc(r).getTime())/86400000));return{r,tot,cobrar,dias};}).sort((a,b)=>b.dias-a.dias||b.cobrar-a.cobrar);
  const head=['Cliente','Empresa','Mes','Ãtem','Total+IVA','Por Cobrar','Mora (dÃ­as)','Fact. NÂ°'];
  const lines=[head.map(q).join(',')];
  rows.forEach(({r,tot,cobrar,dias})=>lines.push([r.nombre,r.empresa,`${MESES[(parseInt(r.mes,10)||1)-1]} ${r.year}`,r.item,tot,cobrar,dias,r.fact||''].map(q).join(',')));
  const blob=new Blob(['ï»¿'+lines.join('\n')],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='cobranza_pendiente_'+hoyCL()+'.csv';a.click();
  toast('âœ“ Cobranza exportada a CSV','success');
}
// â”€â”€ COBRANZA SEMI-AUTOMÃTICA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Lista accionable de la cartera priorizada por mora: cada cliente con botones
// de recordatorio (WhatsApp / correo desde hola@ con la firma de Andrea) y
// registro de cuÃ¡ndo se le cobrÃ³ (localStorage + nota en el cliente).
const _COB_LOG_KEY='thelab_cob_log_v1';
function _cobLog(){try{return JSON.parse(localStorage.getItem(_COB_LOG_KEY)||'{}');}catch(e){return{};}}
function _cobLast(empresa){const l=_cobLog()[(empresa||'').toLowerCase()];return l&&l.length?l[l.length-1]:null;}
function _cobCliente(empresa){
  const k=(empresa||'').toLowerCase(); if(!k||k==='â€”') return null;
  return (state.clientes||[]).find(c=>((c.fields['Empresa']||'').toLowerCase()===k)||((c.fields['Contacto']||'').toLowerCase()===k))||null;
}
function _cobGrupos(){
  const data=finGetAllFacturas().filter(r=>r.porCobrar>0);
  const hoy=Date.now(),byCli=new Map();
  data.forEach(r=>{
    const dias=Math.max(0,Math.floor((hoy-finVenc(r).getTime())/86400000));
    const k=(r.empresa&&r.empresa!=='â€”')?r.empresa:(r.nombre||'â€”');
    const e=byCli.get(k)||{empresa:k,total:0,maxDias:0,n:0};
    e.total+=r.porCobrar;e.maxDias=Math.max(e.maxDias,dias);e.n++;byCli.set(k,e);
  });
  return [...byCli.values()].sort((a,b)=>b.maxDias-a.maxDias||b.total-a.total);
}
// Secuencia de cobranza: toque 1 a los 3 dÃ­as de mora, toque 2 a los 7, toque 3
// (y siguientes) a los 15. El nÃºmero de toques = cuÃ¡ntos recordatorios se enviaron.
const COB_SCHED=[3,7,15];
function _cobToques(emp){const l=_cobLog()[(emp||'').toLowerCase()];return l?l.length:0;}
function _cobDue(g){
  const toques=_cobToques(g.empresa);
  const umbral=COB_SCHED[Math.min(toques,COB_SCHED.length-1)];
  const last=_cobLast(g.empresa);
  const recent=last&&(Date.now()-last.ts<2*864e5);   // no molestar 2 veces en <2 dÃ­as
  return {toque:toques+1,due:g.maxDias>=umbral&&!recent};
}
function _cobMsg(g,contacto,toque){
  const facts=g.n>1?`${g.n} facturas pendientes`:'una factura pendiente';
  const base=`Hola${contacto?' '+contacto:''} ğŸ‘‹ Te saludo de The Lab Solutions.`;
  const monto=`${clp(g.total)}${g.maxDias>0?` (la mÃ¡s antigua lleva ${g.maxDias} dÃ­as vencida)`:''}`;
  const firma='\nâ€” Andrea Garrido Â· The Lab Solutions';
  if(toque>=3) return `${base} Este es un tercer recordatorio por ${facts} por ${monto}. Necesitamos regularizar el pago esta semana para no afectar tu lÃ­nea de crÃ©dito con nosotros. Â¿Lo coordinamos hoy? Quedo muy atenta y con la mejor disposiciÃ³n.${firma}`;
  if(toque===2) return `${base} Te reitero el recordatorio por ${facts} por ${monto}. Â¿Nos confirmas la fecha de pago o prefieres que reenviemos los documentos? Agradezco regularizar a la brevedad.${firma}`;
  return `${base} Te escribo por ${facts} por un total de ${monto}. Â¿Me confirmas si el pago ya estÃ¡ programado o necesitas que te reenviemos los documentos? Â¡Muchas gracias! ğŸ’™${firma}`;
}
function finRenderCobranzaActions(){
  const box=document.getElementById('finCobranzaActions'); if(!box) return;
  // Prioriza los que "toca" contactar hoy (segÃºn la secuencia), luego por mora.
  const gs=_cobGrupos().map(g=>({...g,_d:_cobDue(g)})).sort((a,b)=>(b._d.due-a._d.due)||(b.maxDias-a.maxDias)||(b.total-a.total)).slice(0,12);
  if(!gs.length){box.style.display='none';box.innerHTML='';return;}
  const dueN=gs.filter(g=>g._d.due).length;
  box.style.display='block';
  const _ETQ=['1er toque','2Âº toque','3er toque'];
  box.innerHTML='<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--warn);padding:0 14px 6px">ğŸ“ Secuencia de cobranza'+(dueN?` Â· ${dueN} para contactar hoy`:' Â· al dÃ­a')+'</div>'+gs.map(g=>{
    const cli=_cobCliente(g.empresa);
    const tienePhone=!!(cli&&_getClienteWAPhone(cli));
    const last=_cobLast(g.empresa);
    const emp=escapeHtml(g.empresa);
    const due=g._d.due,toque=Math.min(g._d.toque,3);
    const tChip=`<span class="badge ${due?(toque>=3?'badge-red':toque===2?'badge-orange':'badge-yellow'):'badge-gray'}" style="flex-shrink:0" title="${due?'Corresponde este toque':'En pausa â€” contactado hace <2 dÃ­as o aÃºn no toca'}">${_ETQ[toque-1]||'toque '+toque}</span>`;
    const lastChip=(!due&&last)?`<span style="font-size:9px;color:var(--text3);flex-shrink:0">hace ${Math.max(0,Math.floor((Date.now()-last.ts)/864e5))}d</span>`:'';
    return `<div style="display:flex;align-items:center;gap:9px;padding:8px 14px;border-top:1px solid var(--border);${due?'':'opacity:.6'}">
      <span class="badge ${g.maxDias>60?'badge-red':(g.maxDias>30?'badge-orange':'badge-yellow')}" style="flex-shrink:0" title="Mora mÃ¡xima">${g.maxDias} d</span>
      ${tChip}
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${emp}</div>
        <div style="font-size:10.5px;color:var(--text3)">${clp(g.total)} Â· ${g.n} factura${g.n>1?'s':''}${cli?'':' Â· <span style="color:var(--warn)">sin ficha de cliente</span>'}</div>
      </div>
      ${lastChip}
      <button class="btn btn-primary btn-sm" style="flex-shrink:0" data-emp="${emp}" onclick="cobWhatsApp(this.dataset.emp)" ${tienePhone?'':'title="Sin telÃ©fono en la ficha â€” se abrirÃ¡ WhatsApp para elegir contacto"'}>ğŸ“²</button>
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0" data-emp="${emp}" onclick="cobEmail(this.dataset.emp,this)">ğŸ“§</button>
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0" data-emp="${emp}" title="Registrar gestiÃ³n de cobro sin enviar" onclick="cobRegistrar(this.dataset.emp,'gestiÃ³n manual')">âœ“</button>
    </div>`;
  }).join('');
}
function cobWhatsApp(empresa){
  const g=_cobGrupos().find(x=>x.empresa===empresa); if(!g){toast('Sin datos de esa empresa','error');return;}
  const cli=_cobCliente(empresa);
  const phone=cli?_getClienteWAPhone(cli):'';
  const nombre=cli&&cli.fields['Contacto']?String(cli.fields['Contacto']).trim().split(/\s+/)[0]:'';
  window.open('https://wa.me/'+(phone||'')+'?text='+encodeURIComponent(_cobMsg(g,nombre,_cobToques(empresa)+1)),'_blank');
  cobRegistrar(empresa,'WhatsApp',true);
}
async function cobEmail(empresa,btn){
  const g=_cobGrupos().find(x=>x.empresa===empresa); if(!g){toast('Sin datos de esa empresa','error');return;}
  const cli=_cobCliente(empresa);
  let to=cli?.fields['Email']||prompt('Â¿A quÃ© correo enviamos el recordatorio a '+empresa+'?','');
  if(!to)return; to=String(to).trim();
  if(!validEmail(to)){toast('Correo invÃ¡lido','error');return;}
  const nombre=cli&&cli.fields['Contacto']?String(cli.fields['Contacto']).trim().split(/\s+/)[0]:'';
  const prev=btn?btn.innerHTML:'';
  if(btn){btn.disabled=true;btn.textContent='â€¦';}
  try{
    const _tq=_cobToques(empresa)+1;
    const r=await MAIL.postAs(AGENT_CTA_FROM.email,{action:'send',to,subject:(_tq>=3?'3er recordatorio de pago':_tq===2?'2Âº recordatorio de pago':'Recordatorio de pago')+' â€” The Lab Solutions',body:_cobMsg(g,nombre,_tq),from_name:AGENT_CTA_FROM.name});
    if(r&&!r.error){toast('âœ“ Recordatorio enviado a '+to,'success');cobRegistrar(empresa,'correo',true);}
    else throw new Error(r?.error||'Error desconocido');
  }catch(e){toast('Error: '+e.message,'error');}
  finally{if(btn){btn.disabled=false;btn.innerHTML=prev;}}
}
async function cobRegistrar(empresa,via,silent){
  const k=(empresa||'').toLowerCase();
  const log=_cobLog(); (log[k]=log[k]||[]).push({ts:Date.now(),via:via||'â€”'});
  try{localStorage.setItem(_COB_LOG_KEY,JSON.stringify(log));}catch(e){}
  // Deja constancia en la ficha del cliente (best-effort)
  const cli=_cobCliente(empresa);
  if(cli){
    const nota=`[${hoyCL()}] Recordatorio de cobranza enviado por ${via} (Andrea)`;
    const nuevo=(cli.fields['Notas internas']?String(cli.fields['Notas internas']).trim()+'\n':'')+nota;
    try{await airtableWriteTolerant('Clientes','PATCH',cli.id,{'Notas internas':nuevo});cli.fields['Notas internas']=nuevo;}catch(e){}
  }
  if(!silent) toast('âœ“ GestiÃ³n de cobro registrada','success');
  finRenderCobranzaActions();
}

// Plan de cobranza con IA: prioriza toda la cartera por mora y monto (FINANCE_AGENT)
async function finPlanCobranzaIA(){
  const data=finGetAllFacturas().filter(r=>r.porCobrar>0);
  if(!data.length){toast('No hay facturas pendientes de cobro','info');return;}
  const hoy=Date.now(),byCli=new Map();
  data.forEach(r=>{
    const dias=Math.max(0,Math.floor((hoy-finVenc(r).getTime())/86400000));
    const k=r.empresa||r.nombre||'â€”';
    const e=byCli.get(k)||{empresa:k,total:0,maxDias:0,n:0};
    e.total+=r.porCobrar;e.maxDias=Math.max(e.maxDias,dias);e.n++;byCli.set(k,e);
  });
  const lista=[...byCli.values()].sort((a,b)=>b.maxDias-a.maxDias||b.total-a.total);
  const total=lista.reduce((s,e)=>s+e.total,0);
  const ctx=`CARTERA POR COBRAR (total ${formatCLP(total)}, ${lista.length} clientes):\n`+
    lista.map(e=>`- ${e.empresa}: ${formatCLP(e.total)} Â· ${e.n} factura(s) Â· mora mÃ¡x ${e.maxDias} dÃ­as`).join('\n')+
    `\n\nTAREA: prioriza la cobranza de esta semana. Para los 5â€“8 casos mÃ¡s urgentes indica en orden: prioridad, canal recomendado (WhatsApp â†’ email â†’ llamada â†’ carta segÃºn mora) y la acciÃ³n concreta. Cierra con el monto total recuperable priorizado.`;
  const out=document.getElementById('finCobranzaIAout'),btn=document.getElementById('finCobranzaIABtn'),prev=btn.innerHTML;
  btn.disabled=true;btn.innerHTML='â³ Analizandoâ€¦';
  if(out){out.style.display='block';out.textContent='â³ FINANCE_AGENT priorizando la cobranzaâ€¦';}
  try{showAgentWorking('FINANCE',{verb:'estÃ¡ priorizando tu cobranzaâ€¦',messages:['Revisando la cartera por cobrarâ€¦','Ordenando por mora y montoâ€¦','Definiendo canal y acciÃ³n por clienteâ€¦']});}catch(e){}
  try{
    const cfg=AGENTES_CFG.find(a=>a.id==='FINANCE');
    const resp=await callAgentClaude('FINANCE',cfg.sys,ctx);
    if(out){out.style.whiteSpace='normal';out.innerHTML=formatAgentReport(resp);}
    try{AGENT_LOG.add('FINANCE_AGENT','Plan de cobranza ('+lista.length+' clientes)',resp);}catch(e){}
  }catch(e){if(out)out.textContent='Error: '+e.message;}
  finally{try{hideAgentWorking();}catch(e){}btn.disabled=false;btn.innerHTML=prev;}
}

/* â”€â”€ AntigÃ¼edad de cuentas por cobrar â”€â”€ */
function finRenderAging(){
  const data=finGetAllFacturas().filter(r=>r.porCobrar>0);
  const filterVal=document.getElementById('fin-aging-filter')?.value||'all';
  const hoy=Date.now();
  const buckets={b0:0,b30:0,b60:0,b90:0};
  let sumTotal=0;
  const rows=[];
  data.forEach(r=>{
    const tot=r._total!=null?r._total:(r.valor*r.cant+Math.round(r.valor*r.cant*0.19));
    const cobrar=r.porCobrar||tot;
    sumTotal+=cobrar;
    const dias=Math.max(0,Math.floor((hoy-finVenc(r).getTime())/86400000));
    let tramo,tramoLabel,tramoColor;
    if(dias<=30){buckets.b0+=cobrar;tramo='0';tramoLabel='Corriente';tramoColor='var(--accent3)';}
    else if(dias<=60){buckets.b30+=cobrar;tramo='31';tramoLabel='31â€“60 dÃ­as';tramoColor='var(--warn)';}
    else if(dias<=90){buckets.b60+=cobrar;tramo='61';tramoLabel='61â€“90 dÃ­as';tramoColor='var(--accent2)';}
    else{buckets.b90+=cobrar;tramo='91';tramoLabel='+90 dÃ­as';tramoColor='var(--danger)';}
    if(filterVal==='all'||filterVal===tramo) rows.push({r,tot,cobrar,dias,tramoLabel,tramoColor});
  });
  // KPIs
  const setText=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  setText('fin-ag-total',clp(sumTotal));
  setText('fin-ag-cnt',`${data.length} facturas`);
  setText('fin-ag-b0',clp(buckets.b0));
  setText('fin-ag-b30',clp(buckets.b30));
  setText('fin-ag-b60',clp(buckets.b60));
  setText('fin-ag-b90',clp(buckets.b90));
  // Barra visual
  const barEl=document.getElementById('fin-ag-bar');
  if(barEl&&sumTotal>0){
    const segs=[
      {v:buckets.b0,c:'var(--accent3)'},
      {v:buckets.b30,c:'var(--warn)'},
      {v:buckets.b60,c:'var(--accent2)'},
      {v:buckets.b90,c:'var(--danger)'}
    ].filter(s=>s.v>0);
    barEl.innerHTML=segs.map(s=>`<div style="flex:${s.v};background:${s.c};min-width:4px"></div>`).join('');
  }
  // Tabla
  let html='';
  rows.sort((a,b)=>b.dias-a.dias).forEach(({r,tot,cobrar,dias,tramoLabel,tramoColor})=>{
    html+=`<tr>
      <td><div style="font-weight:600">${escapeHtml(r.nombre||'â€”')}</div><div style="font-size:10px;color:var(--text3)">${escapeHtml(r.empresa||'')}</div></td>
      <td style="font-size:11px">${escapeHtml(r.item||r.fact||'â€”')}</td>
      <td style="text-align:right">${clp(tot)}</td>
      <td style="text-align:right;color:var(--danger);font-weight:700">${clp(cobrar)}</td>
      <td style="text-align:center;font-family:'JetBrains Mono',monospace;font-size:12px;color:${tramoColor};font-weight:700">${dias}</td>
      <td style="text-align:center"><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:${tramoColor}22;color:${tramoColor};border:1px solid ${tramoColor}44">${tramoLabel}</span></td>
    </tr>`;
  });
  if(!html)html='<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--accent3)">âœ“ Sin facturas pendientes de cobro</td></tr>';
  const tb=document.getElementById('fin-aging-body');if(tb)tb.innerHTML=html;
}
function finExportAgingCSV(){
  const data=finGetAllFacturas().filter(r=>r.porCobrar>0);
  const hoy=Date.now();
  const rows=[['Cliente','Empresa','Referencia','Total c/IVA','Por Cobrar','DÃ­as Vencido','Tramo']];
  data.forEach(r=>{
    const tot=r._total!=null?r._total:(r.valor*r.cant+Math.round(r.valor*r.cant*0.19));
    const cobrar=r.porCobrar||tot;
    const dias=Math.max(0,Math.floor((hoy-finVenc(r).getTime())/86400000));
    const tramo=dias<=30?'Corriente':dias<=60?'31-60 dÃ­as':dias<=90?'61-90 dÃ­as':'+90 dÃ­as';
    rows.push([r.nombre||'',r.empresa||'',r.item||r.fact||'',tot,cobrar,dias,tramo]);
  });
  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,ï»¿'+encodeURIComponent(csv);
  a.download='antiguedad_'+hoyCL()+'.csv';a.click();
}

/* â”€â”€ PrÃ©stamos â”€â”€ */
function finRenderPrestamos(){
  const tb=document.getElementById('fin-prestamos-body');
  if(!tb)return;
  const maxDeuda=Math.max(...FIN_PRESTAMOS.map(r=>r.deuda));
  let html='';
  FIN_PRESTAMOS.forEach(r=>{
    const esDev=!r.prestamo&&r.devolucion;
    const pct=Math.round((r.deuda/maxDeuda)*100);
    const barColor=esDev?'var(--accent3)':'var(--danger)';
    html+=`<tr>
      <td data-label="Fecha" style="font-family:monospace;font-size:11px">${r.fecha}</td>
      <td data-label="PrÃ©stamo" style="color:${r.prestamo?'var(--danger)':'var(--text3)'};font-weight:${r.prestamo?700:400}">${r.prestamo?clp(r.prestamo):'â€”'}</td>
      <td data-label="DevoluciÃ³n" style="color:${esDev?'var(--accent3)':'var(--text3)'};font-weight:${esDev?700:400}">${r.devolucion?clp(r.devolucion):'â€”'}</td>
      <td data-label="Deuda" style="font-weight:700;color:var(--accent)">${clp(r.deuda)}</td>
      <td data-label="Progreso" style="min-width:80px"><div style="height:6px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden"><div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;transition:width .3s"></div></div></td>
      <td data-label="Obs." style="font-size:11px;color:var(--text3)">${r.obs||''}</td>
    </tr>`;
  });
  tb.innerHTML=html;
}

/* â”€â”€ Nueva Venta â”€â”€ */
function nvRecalcular(){
  const cant=parseFloat(document.getElementById('nv-cantidad').value)||0;
  const val=parseFloat(document.getElementById('nv-valor').value)||0;
  const pago=parseFloat(document.getElementById('nv-pago').value)||0;
  const costo=parseFloat(document.getElementById('nv-costo').value)||0;
  const neto=cant*val;
  const iva=Math.round(neto*0.19);
  const tot=neto+iva;
  document.getElementById('nv-total').value=clp(neto);
  document.getElementById('nv-iva').value=clp(iva);
  document.getElementById('nv-total-iva').value=clp(tot);
  document.getElementById('nv-utilidad').value=costo?clp(tot-costo):'â€”';
}
function nvLimpiar(){
  ['nv-nombre','nv-empresa','nv-rut','nv-factura','nv-item','nv-pago','nv-costo','nv-fecha-fact','nv-fecha-pago'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.value='';
  });
  ['nv-cantidad','nv-valor'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  nvRecalcular();
}
function nvGuardar(){
  const cant=parseFloat(document.getElementById('nv-cantidad').value)||1;
  const val=parseFloat(document.getElementById('nv-valor').value)||0;
  const pago=parseFloat(document.getElementById('nv-pago').value)||0;
  const nombre=document.getElementById('nv-nombre').value.trim();
  const empresa=document.getElementById('nv-empresa').value.trim();
  const item=document.getElementById('nv-item').value.trim();
  if(!nombre||!item||!val){alert('Completa al menos Nombre, Ãtem y Valor.');return;}
  const noto=cant*val;
  const iva=Math.round(noto*0.19);
  const tot=noto+iva;
  const cobrar=Math.max(0,tot-pago);
  const rec={
    year:document.getElementById('nv-year').value,
    mes:document.getElementById('nv-mes').value,
    nombre,empresa,item,cant,valor:val,
    canal:document.getElementById('nv-canal').value,
    cat:document.getElementById('nv-categoria').value,
    fact:document.getElementById('nv-factura').value,
    pago:pago,porCobrar:cobrar,
    fechaFact:document.getElementById('nv-fecha-fact').value,
    fechaPago:document.getElementById('nv-fecha-pago').value,
    _manual:true
  };
  let existing;try{existing=JSON.parse(localStorage.getItem('fin_ventas')||'[]');}catch(e){existing=[];}
  existing.push(rec);
  try{localStorage.setItem('fin_ventas',JSON.stringify(existing));}catch(e){toast('Sin espacio para guardar','error');return;}
  saveFinVentasAirtable();
  nvLimpiar();
  finRenderNuevaLista();
  toast('Venta guardada correctamente','success');
  finInit();
}
function nvLimpiarTodas(){
  if(!confirm('Â¿Eliminar todas las ventas ingresadas manualmente?'))return;
  localStorage.removeItem('fin_ventas');
  saveFinVentasAirtable();
  finRenderNuevaLista();
  finInit();
}
function finRenderNuevaLista(){
  let data;try{data=JSON.parse(localStorage.getItem('fin_ventas')||'[]');}catch(e){data=[];}
  const MESES_FULL=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  let html='';
  data.forEach((r,idx)=>{
    const neto=r.valor*r.cant;
    const tot=neto+Math.round(neto*0.19);
    const mesNombre=MESES_FULL[(parseInt(r.mes,10)||1)-1];
    const canalBadge=r.canal==='ADWORDS'?'badge-yellow':r.canal==='VENDEDORES'?'badge-green':'badge-gray';
    html+=`<tr>
      <td>${mesNombre} ${r.year}</td>
      <td style="font-weight:600">${r.nombre}</td>
      <td>${r.empresa||'â€”'}</td>
      <td>${r.item}</td>
      <td style="color:var(--accent);font-weight:700">${clp(tot)}</td>
      <td><span class="badge ${canalBadge}">${r.canal}</span></td>
      <td><button class="btn-mini btn-mini-red" onclick="nvEliminar(${idx})">âœ•</button></td>
    </tr>`;
  });
  if(!html)html='<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text3)">Sin ventas ingresadas aÃºn</td></tr>';
  const tb=document.getElementById('fin-nueva-lista-body');
  if(tb)tb.innerHTML=html;
}
function nvEliminar(idx){
  let data;try{data=JSON.parse(localStorage.getItem('fin_ventas')||'[]');}catch(e){data=[];}
  data.splice(idx,1);
  localStorage.setItem('fin_ventas',JSON.stringify(data));
  saveFinVentasAirtable();
  finRenderNuevaLista();
}

/* â”€â”€ Exportar CSV â”€â”€ */
function exportarFinanzasCSV(){
  const data=finGetAllFacturas();
  const headers=['AÃ±o','Mes','Nombre','Empresa','Ãtem','Cantidad','Valor Unit.','Total Neto','IVA','Total+IVA','Por Cobrar','Canal','CategorÃ­a','Factura NÂ°'];
  const rows=data.map(r=>{
    const neto=r.valor*r.cant;
    const iva=Math.round(neto*0.19);
    return [r.year,r.mes,r.nombre,r.empresa,r.item,r.cant,r.valor,neto,iva,neto+iva,r.porCobrar||0,r.canal,r.cat||'',r.fact||''];
  });
  const csv=[headers,...rows].map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='finanzas_thelab.csv';a.click();
  URL.revokeObjectURL(url);
}

/* â”€â”€ KPI expand toggle â”€â”€ */
function finToggleKPI(n,e){
  e.stopPropagation();
  const exp=document.getElementById('fin-k'+n+'-exp');
  const btn=e.currentTarget;
  if(!exp)return;
  const open=exp.style.display!=='none';
  exp.style.display=open?'none':'block';
  btn.innerHTML=open?btn.dataset.label:'â–´ cerrar';
}

/* â”€â”€ KPIs dinÃ¡micos â”€â”€ */
function finInitKPIs(){
  const VM=finVentasMerged();
  const v26=VM[2026];
  const v25=VM[2025];
  const tot26=v26.reduce((a,b)=>a+b,0);
  const meses26=v26.filter(v=>v>0).length||1;
  const avg26=Math.round(tot26/meses26);
  const tot25=v25.reduce((a,b)=>a+b,0);
  const avg25=Math.round(tot25/12);
  const varAvg=avg25?Math.round((avg26/avg25-1)*100):0;
  // Por cobrar: facturas con porCobrar>0 (incluyendo ventas manuales)
  const cobrar=finGetAllFacturas().filter(r=>r.porCobrar>0).reduce((a,r)=>a+r.porCobrar,0);
  const cobrarNeto=Math.round(cobrar/1.19);
  // Prestamo ultimo
  const lastPrestamo=FIN_PRESTAMOS[FIN_PRESTAMOS.length-1];
  // Deuda: prestamos + cobrar estimado
  const deudaPrest=lastPrestamo.deuda;
  // 2024 total
  const tot24=VM[2024].reduce((a,b)=>a+b,0);
  function fmt(n){
    if(n>=1e9)return '$'+(n/1e9).toFixed(1)+'B';
    if(n>=1e6)return '$'+(n/1e6).toFixed(1)+'M';
    return clp(n);
  }
  function setKPI(k,val,sub){
    const el=document.getElementById('fin-k'+k);
    const els=document.getElementById('fin-k'+k+'s');
    if(el)el.textContent=val;
    if(els)els.textContent=sub;
  }
  // Totales por aÃ±o (para expand y record dinÃ¡mico)
  const yearTotals={};
  [2022,2023,2024,2025,2026].forEach(y=>{yearTotals[y]=VM[y].reduce((a,b)=>a+b,0);});
  const recordYear=Object.entries(yearTotals).reduce((a,b)=>b[1]>a[1]?b:a)[0];
  const recordVal=yearTotals[recordYear];
  // Actualizar label record dinÃ¡micamente
  const lbl6=document.getElementById('fin-k6-label');
  if(lbl6)lbl6.textContent='Record â€” AÃ±o '+recordYear;
  setKPI(1,fmt(tot26),'Eneâ€“May 2026');
  setKPI(2,fmt(avg26),(varAvg>=0?'â†‘':'â†“')+Math.abs(varAvg)+'% vs 2025');
  setKPI(3,fmt(cobrar),'Neto: '+fmt(cobrarNeto));
  setKPI(4,fmt(deudaPrest),'Al '+lastPrestamo.fecha);
  setKPI(5,fmt(deudaPrest),'PrÃ©stamos pendientes');
  setKPI(6,fmt(recordVal),'Mejor aÃ±o histÃ³rico');
  // â”€â”€ Contenido expandido â”€â”€
  const MS=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  function er(label,val,hl,note){
    const n=note?`<span style="font-size:10px;opacity:0.5;margin-left:5px">${note}</span>`:'';
    return `<div class="kpi-exp-row${hl?' hl':''}"><span class="ker">${label}</span><span class="kev">${val}${n}</span></div>`;
  }
  function setExp(n,html){const el=document.getElementById('fin-k'+n+'-exp');if(el)el.innerHTML=html;
    const btn=document.querySelector('[onclick="finToggleKPI('+n+',event)"]');
    if(btn&&!btn.dataset.label)btn.dataset.label=btn.innerHTML;}
  // Card 1 â€” Ventas totales por aÃ±o
  setExp(1,[2022,2023,2024,2025,2026].map(y=>er(String(y),fmt(yearTotals[y]),y===2026,y===2026?'YTD':y===+recordYear?'â˜… record':'')).join(''));
  // Card 2 â€” Media mensual por aÃ±o
  setExp(2,[2022,2023,2024,2025,2026].map(y=>{const v=VM[y].filter(x=>x>0);const a=v.length?Math.round(v.reduce((s,x)=>s+x,0)/v.length):0;return er(String(y),fmt(a),y===2026,v.length+'m');}).join(''));
  // Card 3 â€” Top deudores
  const byC={};finGetAllFacturas().filter(r=>r.porCobrar>0).forEach(r=>{const k=(r.nombre||r.empresa||'â€”').slice(0,22);byC[k]=(byC[k]||0)+(r.porCobrar||0);});
  const topC=Object.entries(byC).sort((a,b)=>b[1]-a[1]).slice(0,6);
  setExp(3,topC.length?topC.map(([n,v])=>er(n.length>20?n.slice(0,19)+'â€¦':n,fmt(v),false)).join(''):'<div style="font-size:11px;opacity:0.55;padding:4px 0">Sin facturas pendientes</div>');
  // Card 4 â€” Historial prÃ©stamos (Ãºltimas 7 entradas)
  setExp(4,FIN_PRESTAMOS.slice(-7).reverse().map(r=>{const label=r.fecha+(r.obs?' Â· '+r.obs.slice(0,16):'');const note=r.prestamo?'+'+fmt(r.prestamo):r.devolucion?'âˆ’'+fmt(r.devolucion):'';return er(label,fmt(r.deuda),false,note);}).join(''));
  // Card 5 â€” EvoluciÃ³n deuda (Ãºltimo registro de cada aÃ±o)
  const dbyY={};FIN_PRESTAMOS.forEach(r=>{const y=r.fecha.slice(-2);dbyY[y]=r.deuda;});
  setExp(5,Object.entries(dbyY).sort().map(([y,d])=>er("'"+y,fmt(d),false)).join(''));
  // Card 6 â€” Totales por aÃ±o (con mes rÃ©cord de cada aÃ±o)
  setExp(6,[2022,2023,2024,2025,2026].map(y=>{const mx=Math.max(...VM[y]);const mi=VM[y].indexOf(mx);return er(String(y),fmt(yearTotals[y]),y===+recordYear,MS[mi]+' '+fmt(mx));}).join(''));
  // fecha actualizaciÃ³n
  const fa=document.getElementById('finActualizadoEn');
  if(fa){const now=new Date();fa.textContent='Datos al '+now.getDate()+'/'+(now.getMonth()+1)+'/'+now.getFullYear();}
}

/* â”€â”€ Sparklines en KPIs â”€â”€ */
function finDrawSparklines(){
  const VM=finVentasMerged();
  const datasets=[
    VM[2026].slice(0,6),
    VM[2026].slice(0,6),
    finGetAllFacturas().filter(r=>r.porCobrar>0).reduce((acc,r)=>{const m=parseInt(r.mes)-1;acc[m]=(acc[m]||0)+r.porCobrar;return acc;},Array(6).fill(0)),
    FIN_PRESTAMOS.slice(-6).map(r=>r.deuda),
    FIN_PRESTAMOS.slice(-6).map(r=>r.deuda),
    [2022,2023,2024,2025,2026].map(y=>VM[y].reduce((a,b)=>a+b,0)/1e6)
  ];
  datasets.forEach((data,idx)=>{
    const canvas=document.getElementById('fin-sp'+(idx+1));
    if(!canvas)return;
    const ctx=canvas.getContext('2d');
    const w=80,h=32;
    ctx.clearRect(0,0,w,h);
    const max=Math.max(...data)||1;
    const min=Math.min(...data.filter(v=>v>0))||0;
    const range=max-min||1;
    const pts=data.map((v,i)=>[i*(w/(data.length-1||1)),(1-(v-min)/range)*(h-4)+2]);
    ctx.strokeStyle='rgba(255,255,255,0.7)';
    ctx.lineWidth=1.5;
    ctx.beginPath();
    pts.forEach(([x,y],i)=>i===0?ctx.moveTo(x,y):ctx.lineTo(x,y));
    ctx.stroke();
  });
}

/* â”€â”€ Donut canal â”€â”€ */
function finDrawCanalDonut(){
  const canvas=document.getElementById('finCanalDonut');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const w=160,h=160,cx=80,cy=80,r=60,ri=38;
  ctx.clearRect(0,0,w,h);
  const facts2026=finGetAllFacturas().filter(r=>String(r.year)==='2026');
  const totByCanal={};
  facts2026.forEach(r=>{const amt=r.pago!=null?r.pago:r.valor*r.cant;totByCanal[r.canal]=(totByCanal[r.canal]||0)+amt;});
  const entries=Object.entries(totByCanal).sort((a,b)=>b[1]-a[1]);
  const total=entries.reduce((s,[,v])=>s+v,0)||1;
  const colors=['#00d4cc','#a78bfa','#ffaa00','#ff6b35','#00d4aa','#ff4444'];
  let angle=-Math.PI/2;
  entries.forEach(([canal,val],i)=>{
    const sweep=(val/total)*2*Math.PI;
    ctx.beginPath();ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,r,angle,angle+sweep);ctx.closePath();
    ctx.fillStyle=colors[i%colors.length];ctx.fill();
    ctx.beginPath();ctx.arc(cx,cy,ri,0,2*Math.PI);ctx.fillStyle='#111';ctx.fill();
    angle+=sweep;
  });
  ctx.fillStyle='rgba(255,255,255,0.7)';ctx.font='bold 11px DM Sans';ctx.textAlign='center';
  ctx.fillText('Canal',cx,cy-5);ctx.fillText('2026',cx,cy+10);
  // leyenda
  const legend=document.getElementById('fin-donut-legend');
  if(legend){
    legend.innerHTML=entries.map(([canal,val],i)=>`<div style="display:flex;align-items:center;gap:6px"><div style="width:10px;height:10px;border-radius:2px;background:${colors[i%colors.length]};flex-shrink:0"></div><span style="flex:1;color:var(--text2)">${canal}</span><span style="color:var(--text1);font-weight:600">${Math.round(val/1e6*10)/10}M</span></div>`).join('');
  }
}

/* â”€â”€ Resumen anual dinÃ¡mico â”€â”€ */
function finRenderResumenAnual(){
  const tb=document.getElementById('fin-resumen-anual-body');
  if(!tb)return;
  const anos=[2022,2023,2024,2025,2026];
  const VM=finVentasMerged();
  const totales=anos.map(y=>VM[y].reduce((a,b)=>a+b,0));
  const maxTot=Math.max(...totales)||1;
  const meses={2022:7,2023:12,2024:12,2025:12,2026:5};
  const badges={2022:'badge-gray',2023:'badge-yellow',2024:'badge-orange',2025:'badge-orange',2026:'badge-green'};
  let html='';
  anos.forEach((y,i)=>{
    const tot=totales[i];
    const avg=Math.round(tot/meses[y]);
    const prev=i>0?totales[i-1]:null;
    const varPct2=prev?Math.round((tot/prev-1)*100):null;
    const barW=Math.round((tot/maxTot)*100);
    const isRecord=y===2024;
    html+=`<tr style="${isRecord?'background:rgba(255,170,0,0.06)':''}">
      <td><span class="badge ${badges[y]}">${y}${y===2022||y===2026?' *':''}</span></td>
      <td style="font-weight:${isRecord?700:400}">${clp(tot)}</td>
      <td style="font-size:11px">${clp(avg)}</td>
      <td>${varPct2!==null?`<span class="badge ${varPct2>=0?'badge-green':'badge-red'}">${varPct2>=0?'+':''}${varPct2}%</span>`:'<span class="badge badge-gray">â€”</span>'}</td>
      <td style="min-width:80px"><div style="height:5px;border-radius:3px;background:rgba(255,255,255,0.06)"><div style="height:100%;width:${barW}%;background:${isRecord?'#ffaa00':'rgba(0,212,204,0.7)'};border-radius:3px"></div></div></td>
    </tr>`;
  });
  tb.innerHTML=html;
}

/* â”€â”€ Top clientes â”€â”€ */
function finRenderTopClientes(year){
  if(year===undefined)year=2026;
  const tb=document.getElementById('fin-top-clientes-body');
  if(!tb)return;
  // BotÃ³n activo
  ['all',2022,2023,2024,2025,2026].forEach(y=>{
    const btn=document.getElementById('ftc-'+y);
    if(!btn)return;
    const active=String(y)===String(year);
    btn.style.background=active?'rgba(0,212,204,0.18)':'';
    btn.style.color=active?'var(--accent)':'';
  });
  // TÃ­tulo
  const title=document.getElementById('fin-topclientes-title');
  if(title)title.textContent='Top Clientes '+(year==='all'?'â€” Todos los aÃ±os':year);
  // Datos
  const all=finGetAllFacturas();
  const filtered=year==='all'?all:all.filter(r=>String(r.year)===String(year));
  const byCliente={};
  filtered.forEach(r=>{
    const key=(r.empresa&&r.empresa!=='â€”')?r.empresa:r.nombre;
    const amt=r.pago!=null?r.pago:r.valor*r.cant;
    byCliente[key]=(byCliente[key]||0)+amt;
  });
  const total=Object.values(byCliente).reduce((a,b)=>a+b,0)||1;
  const sorted=Object.entries(byCliente).sort((a,b)=>b[1]-a[1]).slice(0,8);
  tb.innerHTML=sorted.length?sorted.map(([nombre,val])=>`<tr>
    <td style="font-size:11px">${nombre}</td>
    <td style="font-weight:600">${clp(val)}</td>
    <td style="font-size:11px;color:var(--accent)">${Math.round(val/total*100)}%</td>
  </tr>`).join(''):'<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text3)">Sin datos para este perÃ­odo</td></tr>';
}

/* â”€â”€ EvoluciÃ³n de deuda (line chart) â”€â”€ */
function finDrawDeudaTimeline(){
  const canvas=document.getElementById('finDeudaChart');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const w=canvas.offsetWidth||canvas.parentElement?.clientWidth||600;
  canvas.width=w;canvas.height=120;
  ctx.clearRect(0,0,w,120);
  const data=FIN_PRESTAMOS.map(r=>r.deuda);
  const labels=FIN_PRESTAMOS.map(r=>r.fecha);
  const maxV=Math.max(...data)||1;
  const pad={t:10,r:10,b:24,l:70};
  const ch=120-pad.t-pad.b;
  const cw=w-pad.l-pad.r;
  const n=data.length;
  // grid
  ctx.strokeStyle='rgba(255,255,255,0.05)';ctx.lineWidth=1;
  for(let i=0;i<=3;i++){
    const y2=pad.t+ch*(1-i/3);
    ctx.beginPath();ctx.moveTo(pad.l,y2);ctx.lineTo(w-pad.r,y2);ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.3)';ctx.font='8px DM Sans';ctx.textAlign='right';
    ctx.fillText(clp(Math.round(maxV*i/3)),pad.l-3,y2+3);
  }
  // gradient fill
  const grad=ctx.createLinearGradient(0,pad.t,0,pad.t+ch);
  grad.addColorStop(0,'rgba(255,68,68,0.35)');
  grad.addColorStop(1,'rgba(255,68,68,0)');
  const pts=data.map((v,i)=>[pad.l+i*(cw/(n-1||1)),pad.t+ch*(1-v/maxV)]);
  ctx.beginPath();
  pts.forEach(([x,y2],i)=>i===0?ctx.moveTo(x,y2):ctx.lineTo(x,y2));
  ctx.lineTo(pts[pts.length-1][0],pad.t+ch);
  ctx.lineTo(pts[0][0],pad.t+ch);
  ctx.closePath();ctx.fillStyle=grad;ctx.fill();
  // line
  ctx.beginPath();
  pts.forEach(([x,y2],i)=>i===0?ctx.moveTo(x,y2):ctx.lineTo(x,y2));
  ctx.strokeStyle='rgba(255,68,68,0.9)';ctx.lineWidth=2;ctx.stroke();
  // dots at key points
  [0,Math.floor(n/2),n-1].forEach(i=>{
    ctx.beginPath();ctx.arc(pts[i][0],pts[i][1],3,0,2*Math.PI);
    ctx.fillStyle='#ff4444';ctx.fill();
    if(i===0||i===n-1){
      ctx.fillStyle='rgba(255,255,255,0.5)';ctx.font='8px DM Sans';
      ctx.textAlign=i===0?'left':'right';
      ctx.fillText(labels[i],pts[i][0]+(i===0?2:-2),pad.t+ch+14);
    }
  });
}

/* â”€â”€ Tooltip para el chart principal â”€â”€ */
function finSetupTooltip(){
  const canvas=document.getElementById('finVentasChart');
  const tooltip=document.getElementById('fin-chart-tooltip');
  if(!canvas||!tooltip)return;
  canvas.addEventListener('mousemove',(e)=>{
    const years=finChartActiveYear==='all'?[2023,2024,2025,2026]:[finChartActiveYear];
    const w=canvas.width;
    const pad={t:20,r:10,b:40,l:60};
    const cw=w-pad.l-pad.r;
    const grpW=cw/12;
    const rect=canvas.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(canvas.width/rect.width);
    const mi=Math.floor((mx-pad.l)/grpW);
    if(mi<0||mi>11){tooltip.style.display='none';return;}
    const colors={2023:'#a78bfa',2024:'#ffaa00',2025:'#ff6b35',2026:'#00d4cc'};
    const VM=finVentasMerged();
    let lines=`<div style="font-weight:700;margin-bottom:5px;color:var(--text1)">${FIN_MESES[mi]}</div>`;
    years.forEach(y=>{
      const v=VM[y][mi];
      if(v)lines+=`<div style="color:${colors[y]||'#fff'}">${y}: ${clp(v)}</div>`;
    });
    tooltip.innerHTML=lines;
    tooltip.style.display='block';
    const canvasEl=canvas.parentElement;
    const lx=e.clientX-canvasEl.getBoundingClientRect().left;
    tooltip.style.left=Math.min(lx+10,canvasEl.offsetWidth-160)+'px';
    tooltip.style.top=(e.clientY-canvasEl.getBoundingClientRect().top-10)+'px';
  });
  canvas.addEventListener('mouseleave',()=>{tooltip.style.display='none';});
}

/* â”€â”€ Init cuando se activa el tab â”€â”€ */
function finInit(){
  finRenderMensual();
  finInitKPIs();
  renderOverviewFinanzas();
  if(finCurrentTab==='facturas') finRenderFacturas();
  setTimeout(()=>{
    finDrawChart();
    finDrawSparklines();
    finDrawCanalDonut();
    finRenderResumenAnual();
    finRenderTopClientes();
    finSetupTooltip();
  },120);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// LIBRO DIARIO â€” Gastos e Ingresos diarios
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const LD_KEY='fin_diario';
const LD_PAG=25;
let ldFiltradas=[];
let ldPag=0;
let ldSortKey='fecha';
let ldSortDir=-1;

const LD_CAT={
  gasto:['Materiales e insumos','Filamentos / resinas','Maquinaria y equipos',
    'Arriendo local','Servicios bÃ¡sicos','Internet y telecomunicaciones',
    'Marketing y publicidad','Sueldos y honorarios','Cuota prÃ©stamo',
    'Transporte y logÃ­stica','Software y tecnologÃ­a','MantenciÃ³n',
    'Contabilidad y legal','Otros gastos'],
  ingreso:['ImpresiÃ³n 3D','DiseÃ±o 3D','PapelerÃ­a corporativa',
    'Desarrollo web','Marketing digital','ConsultorÃ­a',
    'Arriendo de equipos','Otros ingresos']
};

function ldGetAll(){try{return JSON.parse(localStorage.getItem(LD_KEY)||'[]');}catch(e){return[];}}
function ldSaveAll(arr){try{localStorage.setItem(LD_KEY,JSON.stringify(arr));}catch(e){toast('Sin espacio de almacenamiento','error');}}

function ldSwitchTipo(){
  const tipo=document.getElementById('ld-tipo')?.value||'gasto';
  const sel=document.getElementById('ld-categoria');
  if(!sel)return;
  sel.innerHTML=(LD_CAT[tipo]||[]).map(c=>`<option>${c}</option>`).join('');
}

function ldLimpiar(){
  const hoy=hoyCL();
  const f=document.getElementById('ld-fecha');if(f)f.value=hoy;
  const t=document.getElementById('ld-tipo');if(t)t.value='gasto';
  ldSwitchTipo();
  ['ld-descripcion','ld-referencia','ld-contraparte'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const m=document.getElementById('ld-monto');if(m)m.value='';
  const mt=document.getElementById('ld-metodo');if(mt)mt.value='Transferencia';
}

function ldGuardar(){
  const fecha=document.getElementById('ld-fecha')?.value;
  const tipo=document.getElementById('ld-tipo')?.value;
  const categoria=document.getElementById('ld-categoria')?.value||'';
  const descripcion=(document.getElementById('ld-descripcion')?.value||'').trim();
  const monto=parseFloat(document.getElementById('ld-monto')?.value||0);
  const metodo=document.getElementById('ld-metodo')?.value||'Transferencia';
  const referencia=(document.getElementById('ld-referencia')?.value||'').trim();
  const contraparte=(document.getElementById('ld-contraparte')?.value||'').trim();
  if(!fecha){toast('Selecciona una fecha','error');return;}
  if(!descripcion){toast('Ingresa una descripciÃ³n','error');return;}
  if(!monto||monto<=0){toast('Ingresa un monto vÃ¡lido','error');return;}
  const entry={
    id:Date.now()+'_'+Math.random().toString(36).slice(2,7),
    fecha,tipo,categoria,descripcion,monto,metodo,referencia,contraparte
  };
  const all=ldGetAll();all.push(entry);ldSaveAll(all);
  ldLimpiar();ldInit();
  toast('âœ“ Registro guardado correctamente','success');
}

function ldEliminar(id){
  if(!confirm('Â¿Eliminar este registro?'))return;
  ldSaveAll(ldGetAll().filter(e=>e.id!==id));
  ldInit();toast('Registro eliminado','success');
}

function ldSort(key){
  if(ldSortKey===key)ldSortDir*=-1;
  else{ldSortKey=key;ldSortDir=-1;}
  ldRenderTabla();
}

function ldFiltrar(){
  const desde=document.getElementById('ld-f-desde')?.value||'';
  const hasta=document.getElementById('ld-f-hasta')?.value||'';
  const tipo=document.getElementById('ld-f-tipo')?.value||'';
  const busca=(document.getElementById('ld-f-busca')?.value||'').toLowerCase();
  ldFiltradas=ldGetAll().filter(e=>{
    if(desde&&e.fecha<desde)return false;
    if(hasta&&e.fecha>hasta)return false;
    if(tipo&&e.tipo!==tipo)return false;
    if(busca&&![e.descripcion,e.categoria,e.referencia,e.contraparte].join(' ').toLowerCase().includes(busca))return false;
    return true;
  });
  ldFiltradas.sort((a,b)=>{
    let va=a[ldSortKey],vb=b[ldSortKey];
    if(ldSortKey==='monto'){va=+va;vb=+vb;}
    return va>vb?ldSortDir:va<vb?-ldSortDir:0;
  });
  ldPag=0;ldRenderTabla();ldRenderKPIs();
}

function ldRenderTabla(){
  const tb=document.getElementById('ld-tbody');
  if(!tb)return;
  const total=ldFiltradas.length;
  const countEl=document.getElementById('ld-count');
  if(countEl){
    const ing=ldFiltradas.filter(e=>e.tipo==='ingreso');
    const gas=ldFiltradas.filter(e=>e.tipo==='gasto');
    const sumIng=ing.reduce((s,e)=>s+(+e.monto||0),0);
    const sumGas=gas.reduce((s,e)=>s+(+e.monto||0),0);
    const neto=sumIng-sumGas;
    countEl.innerHTML=total===0?'Sin registros para este filtro':
      `<span style="color:var(--accent3)">â†‘ ${ing.length} ingresos ${fmtMoney(sumIng)}</span>&nbsp;Â·&nbsp;<span style="color:var(--danger)">â†“ ${gas.length} gastos ${fmtMoney(sumGas)}</span>&nbsp;Â·&nbsp;<strong style="color:${neto>=0?'var(--accent3)':'var(--danger)'}">Neto: ${neto>=0?'+':'âˆ’'}${fmtMoney(Math.abs(neto))}</strong>`;
  }
  const page=ldFiltradas.slice(ldPag*LD_PAG,(ldPag+1)*LD_PAG);
  if(!page.length){
    tb.innerHTML='<tr><td colspan="9" style="text-align:center;padding:28px;color:var(--text3)">Sin registros â€” agrega el primer movimiento arriba</td></tr>';
    document.getElementById('ld-pag').innerHTML='';return;
  }
  tb.innerHTML=page.map(e=>{
    const isIng=e.tipo==='ingreso';
    const color=isIng?'var(--accent3)':'var(--danger)';
    const badge=isIng
      ?'<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:rgba(100,220,80,0.12);color:var(--accent3);font-weight:600">â†‘ Ingreso</span>'
      :'<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:rgba(255,68,68,0.12);color:var(--danger);font-weight:600">â†“ Gasto</span>';
    return`<tr>
<td style="white-space:nowrap;font-size:12px">${e.fecha}</td>
<td>${badge}</td>
<td style="color:var(--text2);font-size:11px">${escapeHtml(e.categoria||'â€”')}</td>
<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(e.descripcion)}">${escapeHtml(e.descripcion)}</td>
<td style="font-weight:700;color:${color};white-space:nowrap;text-align:right">${isIng?'+':'âˆ’'}${fmtMoney(e.monto)}</td>
<td style="font-size:11px;color:var(--text3)">${escapeHtml(e.metodo||'â€”')}</td>
<td style="font-size:11px;color:var(--text3)">${escapeHtml(e.referencia||'â€”')}</td>
<td style="font-size:11px;color:var(--text3)">${escapeHtml(e.contraparte||'â€”')}</td>
<td><button class="btn btn-danger btn-sm" style="padding:2px 6px;font-size:12px" onclick="ldEliminar('${e.id}')" title="Eliminar">âœ•</button></td>
</tr>`;
  }).join('');
  const totalPages=Math.ceil(total/LD_PAG);
  const pagEl=document.getElementById('ld-pag');
  if(totalPages<=1){pagEl.innerHTML='';return;}
  pagEl.innerHTML=`<button class="btn btn-ghost btn-sm" onclick="ldPagGo(${ldPag-1})" ${ldPag===0?'disabled':''}>â€¹ Anterior</button><span style="font-size:11px;color:var(--text3);margin:0 8px">PÃ¡g ${ldPag+1} / ${totalPages}</span><button class="btn btn-ghost btn-sm" onclick="ldPagGo(${ldPag+1})" ${ldPag>=totalPages-1?'disabled':''}>Siguiente â€º</button>`;
}

function ldPagGo(p){ldPag=p;ldRenderTabla();}

function ldRenderKPIs(){
  const hoy=hoyCL();
  const mes=hoy.slice(0,7);
  const all=ldGetAll();
  const mesData=all.filter(e=>e.fecha.startsWith(mes));
  const hoyData=all.filter(e=>e.fecha===hoy);
  const sum=(arr,tipo)=>arr.filter(e=>e.tipo===tipo).reduce((s,e)=>s+(+e.monto||0),0);
  const fIng=sum(ldFiltradas,'ingreso'),fGas=sum(ldFiltradas,'gasto');
  const mIng=sum(mesData,'ingreso'),mGas=sum(mesData,'gasto');
  const hNet=sum(hoyData,'ingreso')-sum(hoyData,'gasto');
  const saldo=fIng-fGas,sMes=mIng-mGas;
  function s(id,v){const el=document.getElementById(id);if(el)el.textContent=v;}
  function sc(id,c){const el=document.getElementById(id);if(el)el.style.color=c;}
  const ingCount=ldFiltradas.filter(e=>e.tipo==='ingreso').length;
  const gasCount=ldFiltradas.filter(e=>e.tipo==='gasto').length;
  s('ld-k-ing',fmtMoney(fIng));s('ld-k-ings',ingCount+' entr'+(ingCount===1?'ada':'adas'));
  s('ld-k-gas',fmtMoney(fGas));s('ld-k-gass',gasCount+' salid'+(gasCount===1?'a':'as'));
  s('ld-k-sal',fmtMoney(Math.abs(saldo)));s('ld-k-sals',saldo>=0?'superÃ¡vit':'dÃ©ficit');sc('ld-k-sal',saldo>=0?'var(--accent3)':'var(--danger)');
  s('ld-k-mes',fmtMoney(Math.abs(sMes)));s('ld-k-mess',(sMes>=0?'â†‘ superÃ¡vit':'â†“ dÃ©ficit')+' en '+new Date().toLocaleString('es-CL',{month:'long'}));sc('ld-k-mes',sMes>=0?'var(--accent3)':'var(--danger)');
  s('ld-k-hoy',hoyData.length===0?'$0':fmtMoney(Math.abs(hNet)));s('ld-k-hoys',hoyData.length+' mov. hoy'+(hNet!==0?' Â· '+(hNet>=0?'â†‘':'â†“'):''));sc('ld-k-hoy',hNet>=0?'var(--accent3)':'var(--danger)');
}

function ldExportCSV(){
  if(!ldFiltradas.length){toast('Sin datos para exportar','error');return;}
  const rows=[['Fecha','Tipo','CategorÃ­a','DescripciÃ³n','Monto','MÃ©todo','Referencia','Proveedor/Cliente']];
  ldFiltradas.forEach(e=>rows.push([e.fecha,e.tipo,e.categoria,e.descripcion,e.monto,e.metodo||'',e.referencia||'',e.contraparte||'']));
  const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob=new Blob(['ï»¿'+csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='libro_diario_thelab.csv';a.click();
  URL.revokeObjectURL(url);toast('âœ“ CSV exportado','success');
}

function ldInit(){
  const hoy=hoyCL();
  const fd=document.getElementById('ld-fecha');if(fd&&!fd.value)fd.value=hoy;
  const desde=document.getElementById('ld-f-desde');
  const hasta=document.getElementById('ld-f-hasta');
  if(desde&&!desde.value)desde.value=hoy.slice(0,8)+'01';
  if(hasta&&!hasta.value)hasta.value=hoy;
  ldSwitchTipo();
  ldFiltrar();
  try{renderArqueo();}catch(e){}
}

/* â”€â”€ Overview Google Ads snapshot â”€â”€ */
function ovSyncAdsKPIs(data){
  function set(id,v){const el=document.getElementById(id);if(el)el.textContent=v;}
  const gasto=data.gasto||0,conv=data.conversiones||0,clics=data.clics||0;
  const valConv=data.valor_conversion||0;
  const roas=gasto>0?(valConv/gasto):0;
  set('ov-ads-gasto',fmtMoney(gasto));
  set('ov-ads-gastos',data.periodo||'30 dÃ­as');
  set('ov-ads-conv',conv>0?conv.toFixed(0):'0');
  set('ov-ads-convs',conv>0?fmtMoney(valConv/conv)+'/conv':'â€”');
  set('ov-ads-clics',fmtNum(clics));
  set('ov-ads-roas',roas>0?roas.toFixed(2)+'x':'â€”');
  set('ov-ads-roass',roas>0?'retorno sobre gasto':'sin conversiones');
  set('ov-ads-status','Actualizado '+new Date().toLocaleTimeString('es-CL'));
}

/* â”€â”€ Overview Finanzas snapshot â”€â”€ */
function renderOverviewFinanzas(){
  function fmt(n){
    if(n>=1e9)return '$'+(n/1e9).toFixed(1)+'B';
    if(n>=1e6)return '$'+(n/1e6).toFixed(1)+'M';
    return clp(n);
  }
  function set(id,v){const el=document.getElementById(id);if(el)el.textContent=v;}

  const VM=finVentasMerged();
  const v26=VM[2026];
  const v25=VM[2025];
  const tot26=v26.reduce((a,b)=>a+b,0);
  const meses26=v26.filter(v=>v>0).length||1;
  const avg26=Math.round(tot26/meses26);
  const avg25=Math.round(v25.reduce((a,b)=>a+b,0)/12);
  const varAvg=avg25?Math.round((avg26/avg25-1)*100):0;
  const allFacts=finGetAllFacturas();
  const cobrar=allFacts.filter(r=>r.porCobrar>0).reduce((a,r)=>a+r.porCobrar,0);
  const nFact=allFacts.filter(r=>r.porCobrar>0).length;
  const deuda=FIN_PRESTAMOS[FIN_PRESTAMOS.length-1].deuda;

  set('ov-fin-v26', fmt(tot26));
  set('ov-fin-v26s', 'Eneâ€“May 2026 Â· '+meses26+' meses');
  set('ov-fin-avg', fmt(avg26));
  set('ov-fin-avgs', (varAvg>=0?'â†‘':'â†“')+Math.abs(varAvg)+'% vs media 2025');
  set('ov-fin-cobrar', fmt(cobrar));
  set('ov-fin-cobras', nFact+' factura'+(nFact!==1?'s':'')+' pendiente'+(nFact!==1?'s':''));
  set('ov-fin-deuda', fmt(deuda));
  set('ov-fin-deudas', 'al '+FIN_PRESTAMOS[FIN_PRESTAMOS.length-1].fecha);

  // Mini bar chart: Ãºltimos 8 meses (Oct 2025 â€“ May 2026)
  setTimeout(drawOvFinChart, 80);
}

function drawOvFinChart(){
  const canvas=document.getElementById('ov-fin-chart');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const w=canvas.offsetWidth||canvas.parentElement?.clientWidth||400;
  canvas.width=w; canvas.height=54;
  ctx.clearRect(0,0,w,54);

  // oct=9, nov=10, dic=11 de 2025; ene=0..may=4 de 2026
  const VM=finVentasMerged();
  const meses=[
    {lbl:'Oct25',v:VM[2025][9],color:'rgba(255,107,53,0.7)'},
    {lbl:'Nov25',v:VM[2025][10],color:'rgba(255,107,53,0.7)'},
    {lbl:'Dic25',v:VM[2025][11],color:'rgba(255,107,53,0.7)'},
    {lbl:'Ene26',v:VM[2026][0],color:'rgba(0,212,204,0.85)'},
    {lbl:'Feb26',v:VM[2026][1],color:'rgba(0,212,204,0.85)'},
    {lbl:'Mar26',v:VM[2026][2],color:'rgba(0,212,204,0.85)'},
    {lbl:'Abr26',v:VM[2026][3],color:'rgba(0,212,204,0.85)'},
    {lbl:'May26',v:VM[2026][4],color:'rgba(0,212,204,0.85)'},
  ];
  const maxV=Math.max(...meses.map(m=>m.v))||1;
  const pad={t:4,b:16,l:2,r:2};
  const ch=54-pad.t-pad.b;
  const cw=w-pad.l-pad.r;
  const bw=Math.floor(cw/meses.length)-3;
  meses.forEach((m,i)=>{
    if(!m.v)return;
    const bh=Math.round((m.v/maxV)*ch);
    const x=pad.l+i*(bw+3)+1;
    const y=pad.t+ch-bh;
    ctx.fillStyle=m.color;
    ctx.beginPath();ctx.roundRect(x,y,bw,bh,2);ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.35)';
    ctx.font='7px DM Sans';ctx.textAlign='center';
    ctx.fillText(m.lbl,x+bw/2,54-2);
  });
}

/* Hookear al switchTab existente */
const _origSwitch=typeof switchTab!=='undefined'?switchTab:null;
document.addEventListener('DOMContentLoaded',()=>{
  // Precargar mes actual en el form de nueva venta
  const now=new Date();
  const mesEl=document.getElementById('nv-mes');
  if(mesEl)mesEl.value=String(now.getMonth()+1).padStart(2,'0');
  const yearEl=document.getElementById('nv-year');
  if(yearEl)yearEl.value=String(now.getFullYear());
  // Renderizar snapshot de finanzas en el overview al cargar
  renderOverviewFinanzas();
});

/* Observar cuando el tab finanzas se activa */
const _finObserver=new MutationObserver((muts)=>{
  muts.forEach(m=>{
    if(m.target.id==='tab-finanzas'&&m.target.classList.contains('active')){
      finInit();
    }
  });
});
const _finPanel=document.getElementById('tab-finanzas');
if(_finPanel)_finObserver.observe(_finPanel,{attributes:true,attributeFilter:['class']});

/* ResizeObserver para redibujado responsivo */
if(typeof ResizeObserver!=='undefined'&&_finPanel){
  let _finResizeTimer;
  const _finResizeObs=new ResizeObserver(()=>{
    clearTimeout(_finResizeTimer);
    _finResizeTimer=setTimeout(()=>{
      if(_finPanel.classList.contains('active')){
        finDrawChart();
        finDrawCanalDonut();
        finDrawDeudaTimeline();
        finDrawSparklines();
      }
    },100);
  });
  _finResizeObs.observe(_finPanel);
}

// â”€â”€ MenÃº NUEVO (dropdown topbar + acordeÃ³n mobile) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function irALibroDiario(){
  switchTab('finanzas');
  setTimeout(()=>{
    finSwitchTab('diario');
    setTimeout(()=>{
      const el=document.getElementById('ld-fecha');
      if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.focus();}
    },100);
  },80);
}
function irANuevaVenta(){
  switchTab('finanzas');
  setTimeout(()=>{
    finSwitchTab('nueva');
    setTimeout(()=>{
      const el=document.getElementById('nv-nombre');
      if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.focus();}
    },100);
  },80);
}
// â”€â”€ CALCULADORA COTIZACIÃ“N 3D â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const C3D_MATERIALES={
  'PLA':      {preciog:18,merma:0.2,unidad:'gramos'},
  'PLA+':     {preciog:20,merma:0.2,unidad:'gramos'},
  'PETG':     {preciog:20,merma:0.2,unidad:'gramos'},
  'Resina UV':{preciog:30,merma:0.2,unidad:'mL'}
};
const C3D_MAQUINAS=[
  {id:'ender7',  nombre:'Ender 7',        sub:'FDM',      costo:150},
  {id:'halot',   nombre:'Halot One',      sub:'Resina',   costo:150},
  {id:'wycure',  nombre:'Wash & Cure',    sub:'Post-proc',costo:150},
  {id:'cnc',     nombre:'CNC',            sub:'$330/h',   costo:330},
  {id:'router',  nombre:'Router',         sub:'$100/h',   costo:100},
  {id:'fresa',   nombre:'Frem«ëŒ+Š×®º+º$zzb¥ç6rÂ7V#¢rCSö‚rÂ6÷7Fó£SÒÀ¢¶–C¢vÇW¢rÂæöÖ'&S¢tÇW¢òVÆV7G"ârÂ7V#¢rCö‚rÂ6÷7Fó£ÒÀ¥Ó°¦6öç7B34EôU…E$3Õ°¢¶–C¢vF—6Væ–òrÂæöÖ'&S¢tF—6\;ò†fÆB’rÂ6÷7Fó£#ÂF—ó¢vfÆBwÒÀ¢¶–C¢v‡†‚rÂæöÖ'&S¢u÷7B×&ö6W6ò…„‚rÂ6÷7Fó£SÂF—ó¢vfÆBwÒÀ¢¶–C¢w6¶v–ærrÆæöÖ'&S¢u6¶v–ærrÂ6÷7Fó£ÂF—ó¢wVæ—BwÒÀ¢¶–C¢w–çGW&rÂæöÖ'&S¢u–çFFòrÂ6÷7Fó£#ÂF—ó¢wVæ—BwÒÀ¢¶–C¢vÆ–¦rÂæöÖ'&S¢tÆ–¦òVÆ–FòrÂ6÷7Fó£C#ÂF—ó¢wVæ—BwÒÀ¢¶–C¢v6WFöærÂæöÖ'&S¢t6WFöæ†g&66ò’rÂ6÷7Fó£ÂF—ó¢vfÆBwÒÀ¢¶–C¢vÆ6ö†öÂrÂæöÖ'&S¢tÆ6ö†öÂ•4òÇBrÂ6÷7Fó£3ccÂF—ó¢vfÆBwÒÀ¢¶–C¢v6–æö7"rÂæöÖ'&S¢t6–æö7&–ÆFòrÂ6÷7Fó£ÂF—ó¢vfÆBwÒÀ¢¶–C¢wöÆ—W"rÂæöÖ'&S¢uöÆ—W&WFæòrÂ6÷7Fó£ÂF—ó¢vfÆBwÒÀ¢¶–C¢vÆ6rÂæöÖ'&S¢tÆ6‡÷"–W¦’rÂ6÷7Fó£SÂF—ó¢wVæ—BwÒÀ¢¶–C¢vf–ÆÆW"rÂæöÖ'&S¢tf–ÆÆW"òÖ6–ÆÆrÂ6÷7Fó£ÂF—ó¢vfÆBwÒÀ¢¶–C¢vGFbrÂæöÖ'&S¢t–×&W6œ;6âEDbrÂ6÷7Fó£ƒÂF—ó¢vfÆBwÒÀ¥Ó° ¢òò)H)H4Ä5TÄDõ$4B”äÄ”äR†FVçG&òFRçVWf6÷F—¦6œ;6â’)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¦ÆWB36E–W¦6÷VçFW#Ó°¦ÆWB36E–W¦47F—f3ÕµÓ°¦ÆWB36EF&vWCÒvâs²òòvârÒçVWf6÷F—¦6œ;6âÂvRrÒVF—F"6÷F—¦6œ;6à ¦gVæ7F–öâö36D'Fç2‚—·&WGW&ç¶ã¦Fö7VÖVçBævWDVÆVÖVçD'”–B‚v36B×FövvÆRÖ'Fâr’ÆS¦Fö7VÖVçBævWDVÆVÖVçD'”–B‚v36BÖ'FâÖRr—Ó·Ğ¦gVæ7F–öâFövvÆT36D–æÆ–æR†7G‚—°¢7GƒÖ7G‡ÇÂvâs°¢6öç7BæVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v36BÖ–æÆ–æR×æVÂr“°¢–b‚æVÂ’&WGW&ã°¢6öç7B'Fç3Õö36D'Fç2‚“°¢6öç7B—4÷Vã×æVÂç7G–ÆRæF—7Æ’ÓÒvæöæRs°¢–b†—4÷Vâbf36EF&vWCÓÓÖ7G‚—°¢æVÂç7G–ÆRæF—7Æ“ÒvæöæRs°¢ö&¦V7BçfÇVW2†'Fç2’æf÷$V6‚†#Óç¶–b†"–"ç7G–ÆRæ&6¶w&÷VæCÒrs·Ò“°¢&WGW&ã°¢Ğ¢òòVÂæVÂW2;¦æ–6ó¢6R×VWfRÂ†÷7BFVÂ6öçFW‡Fò7F—fğ¢36EF&vWCÖ7Gƒ°¢6öç7B†÷7CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v6Æ2Ö†÷7BÒr¶7G‚“°¢–b††÷7B’†÷7BæVæD6†–ÆB‡æVÂ“°¢æVÂç7G–ÆRæF—7Æ“Òv&Æö6²s°¢ö&¦V7BæVçG&–W2†'Fç2’æf÷$V6‚‚…¶²Æ%Ò“Óç¶–b†"–"ç7G–ÆRæ&6¶w&÷VæCÖ³ÓÓÖ7Gƒòw&v&ƒÃ#"Ã#BÃãR’s¢rs·Ò“°¢–b‚36E–W¦47F—f2æÆVæwF‚’36DFE–W¦‚“°¢36EWFFTÆÂ‚“°§Ğ ¦gVæ7F–öâ36DFE–W¦‚—°¢6öç7B–CÖ36E–W¦6÷VçFW"²³°¢36E–W¦47F—f2çW6‚†–B“°¢6öç7BÆ—7CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v36BÖ’×–W¦2r“°¢–b‚Æ—7B’&WGW&ã°¢6öç7BÖ–çWG3Ô34EôÔT”ä2æÖ†ÓÓæÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£Wƒ¶Ö–â×v–GFƒ£#‚#ãÇ7â7G–ÆSÒ&föçB×6—¦S£—ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶fÆWƒ£·v†—FR×76S¦æ÷w&#âG¶ÒææöÖ'&WÓÆ'#ãÇ7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2“¶föçB×6—¦S£‡‚#âBG¶Òæ6÷7FòçFôÆö6ÆU7G&–ær‚vW2Ô4Âr—ÒöƒÂ÷7ããÂ÷7ããÆ–çWBG—SÒ&çVÖ&W""Ö–ãÒ#"7FWÒ#ãR"fÇVSÒ#"–CÒ&36B×ÒÒG¶–GÒÒG¶Òæ–GÒ"öæ–çWCÒ&36EWFFTÆÂ‚’"7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£Wƒ¶6öÆ÷#§f"‚Ò×FW‡B“¶föçBÖfÖ–Ç“¢t¦WD'&–ç2ÖöæòrÆÖöæ÷76S¶föçB×6—¦S£ƒ·FF–æs£7‚Wƒ¶÷WFÆ–æS¦æöæS·v–GFƒ£S'ƒ·FW‡BÖÆ–vã¦6VçFW"#ãÂöF—cæ’æ¦ö–â‚rr“°¢6öç7BW‡G&4–çWG3Ô34EôU…E$2æÖ†SÓæÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£Wƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6S2“¶&÷&FW"×&F—W3£Wƒ·FF–æs£G‚w‚#ãÆ–çWBG—SÒ&6†V6¶&÷‚"–CÒ&36BÖW‚ÒG¶–GÒÒG¶Ræ–GÒ"öæ6†ævSÒ&36EWFFTÆÂ‚’"7G–ÆSÒ&66VçBÖ6öÆ÷#§f"‚ÒÖ66VçB“¶7W'6÷#§ö–çFW#·v–GFƒ£7ƒ¶†V–v‡C£7ƒ¶fÆW‚×6‡&–æ³£#ãÆÆ&VÂf÷#Ò&36BÖW‚ÒG¶–GÒÒG¶Ræ–GÒ"7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C"“¶7W'6÷#§ö–çFW#¶fÆWƒ£¶Æ–æRÖ†V–v‡C£ã"#âG¶RææöÖ'&WÓÂöÆ&VÃâG¶RçF—óÓÓÒwVæ—BsöÆ–çWBG—SÒ&çVÖ&W""Ö–ãÒ#"fÇVSÒ#"–CÒ&36BÖW‡G’ÒG¶–GÒÒG¶Ræ–GÒ"öæ–çWCÒ&36EWFFTÆÂ‚’"F—FÆSÒ$6çF–FB"7G–ÆSÒ'v–GFƒ£Cƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£Gƒ¶6öÆ÷#§f"‚Ò×FW‡B“¶föçBÖfÖ–Ç“¢t¦WD'&–ç2ÖöæòrÆÖöæ÷76S¶föçB×6—¦S£ƒ·FF–æs£'‚Gƒ¶÷WFÆ–æS¦æöæS·FW‡BÖÆ–vã¦6VçFW"#æ¢rfæ'7²wÓÇ7â7G–ÆSÒ&föçB×6—¦S£—ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“·v†—FR×76S¦æ÷w&¶fÆW‚×6‡&–æ³£#âBG¶Ræ6÷7FòçFôÆö6ÆU7G&–ær‚vW2Ô4Âr—ÒG¶RçF—óÓÓÒwVæ—Bsòr÷Rs¢rwÓÂ÷7ããÂöF—cæ’æ¦ö–â‚rr“°¢6öç7Bw&W#ÖFö7VÖVçBæ7&VFTVÆVÖVçB‚vF—br“°¢w&W"æ–CÒv36B×–W¦Òr¶–C°¢w&W"æ–ææW$…DÔÃÖÆF—b7G–ÆSÒ&&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£‡ƒ¶÷fW&fÆ÷s¦†–FFVâ#à¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6S2“·FF–æs£g‚ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶F—7Æ“¦fÆWƒ¶v£‡ƒ¶Æ–vâÖ—FV×3¦6VçFW#¶fÆW‚×w&§w&#à¢Ç7â7G–ÆSÒ&föçB×6—¦S£ƒ¶föçB×vV–v‡C£s¶6öÆ÷#§f"‚Ò×FW‡C2“·FW‡B×G&ç6f÷&Ó§WW&66S¶fÆW‚×6‡&–æ³£#å–W¦G¶36E–W¦47F—f2æÆVæwF‡ÓÂ÷7ãà¢Æ–çWBG—SÒ'FW‡B"Æ6V†öÆFW#Ò$FW67&—6œ;6âFRÆ–W¦âââ"–CÒ&36B×ÖFW62ÒG¶–GÒ"öæ–çWCÒ&36EWFFTÆÂ‚’"7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£Cƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£Wƒ¶6öÆ÷#§f"‚Ò×FW‡B“¶föçBÖfÖ–Ç“¢tDÒ6ç2rÇ6ç2×6W&–c¶föçB×6—¦S£ƒ·FF–æs£G‚‡ƒ¶÷WFÆ–æS¦æöæR#à¢Æ–çWBG—SÒ&çVÖ&W""Ö–ãÒ#"fÇVSÒ#"–CÒ&36B××G’ÒG¶–GÒ"öæ–çWCÒ&36EWFFTÆÂ‚’"F—FÆSÒ$6çF–FBFR–W¦2"7G–ÆSÒ'v–GFƒ£Sgƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£Wƒ¶6öÆ÷#§f"‚Ò×FW‡B“¶föçBÖfÖ–Ç“¢t¦WD'&–ç2ÖöæòrÆÖöæ÷76S¶föçB×6—¦S£ƒ·FF–æs£G‚gƒ¶÷WFÆ–æS¦æöæS·FW‡BÖÆ–vã¦6VçFW"#à¢Ç7â7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶fÆW‚×6‡&–æ³£#çVæBãÂ÷7ãà¢Æ'WGFöâG—SÒ&'WGFöâ"öæ6Æ–6³Ò&36E&VÖ÷fU–W¦‚G¶–GÒ’"7G–ÆSÒ&&6¶w&÷VæC¦æöæS¶&÷&FW#¦æöæS¶6öÆ÷#§f"‚Ò×FW‡C2“¶föçB×6—¦S£gƒ¶7W'6÷#§ö–çFW#·FF–æs£'ƒ¶Æ–æRÖ†V–v‡C£¶fÆW‚×6‡&–æ³£"öæÖ÷W6VVçFW#Ò'F†—2ç7G–ÆRæ6öÆ÷#Òwf"‚ÒÖFævW"’r"öæÖ÷W6VÆVfSÒ'F†—2ç7G–ÆRæ6öÆ÷#Òwf"‚Ò×FW‡C2’r"F—FÆSÒ%V—F"–W¦#î)ÉSÂö'WGFöãà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3£#‚g#¶v£#à¢ÆF—b7G–ÆSÒ'FF–æs£‡‚ƒ¶&÷&FW"×&–v‡C£‚6öÆ–Bf"‚ÒÖ&÷&FW#"’#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£—ƒ¶föçB×vV–v‡C£s·FW‡B×G&ç6f÷&Ó§WW&66S¶6öÆ÷#§f"‚Ò×FW‡C2“¶Ö&v–âÖ&÷GFöÓ£W‚#äÖFW&–ÃÂöF—cà¢Ç6VÆV7B–CÒ&36B×ÖÖBÒG¶–GÒ"öæ6†ævSÒ&36EWDÖDÆ&Â‚G¶–GÒ“¶36EWFFTÆÂ‚’"7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£Wƒ¶6öÆ÷#§f"‚Ò×FW‡B“¶föçBÖfÖ–Ç“¢tDÒ6ç2rÇ6ç2×6W&–c¶föçB×6—¦S£ƒ·FF–æs£G‚‡ƒ¶÷WFÆ–æS¦æöæS·v–GFƒ£S¶Ö&v–âÖ&÷GFöÓ£gƒ¶7W'6÷#§ö–çFW"#à¢Æ÷F–öâfÇVSÒ%Ä#åÄ(	BC‚ösÂö÷F–öãà¢Æ÷F–öâfÇVSÒ%Ä²"6VÆV7FVCåÄ²(	BC#ösÂö÷F–öãà¢Æ÷F–öâfÇVSÒ%UDr#åUDr(	BC#ösÂö÷F–öãà¢Æ÷F–öâfÇVSÒ%&W6–æUb#å&W6–æUb(	BC3öÔÃÂö÷F–öãà¢Â÷6VÆV7Cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£g‚#à¢Æ–çWBG—SÒ&çVÖ&W""Ö–ãÒ#"fÇVSÒ#"–CÒ&36B×ÖÖGG’ÒG¶–GÒ"öæ–çWCÒ&36EWFFTÆÂ‚’"Æ6V†öÆFW#Ò#"7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£Wƒ¶6öÆ÷#§f"‚Ò×FW‡B“¶föçBÖfÖ–Ç“¢t¦WD'&–ç2ÖöæòrÆÖöæ÷76S¶föçB×6—¦S£ƒ·FF–æs£G‚wƒ¶÷WFÆ–æS¦æöæS·v–GFƒ£sW‚#à¢Ç7â–CÒ&36B×ÖÖGVæ—BÒG¶–GÒ"7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#æsÂ÷7ãà¢ÂöF—cà¢ÂöF—cà¢ÆF—b7G–ÆSÒ'FF–æs£‡‚‚#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£—ƒ¶föçB×vV–v‡C£s·FW‡B×G&ç6f÷&Ó§WW&66S¶6öÆ÷#§f"‚Ò×FW‡C2“¶Ö&v–âÖ&÷GFöÓ£W‚#äÜ:V–æ2††÷&2“ÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVB†WFòÖf–ÆÂÆÖ–æÖ‚ƒ3‚Ãg"’“¶v£g‚#âG¶Ö–çWG7ÓÂöF—cà¢ÂöF—cà¢ÂöF—cà¢ÆF—b7G–ÆSÒ'FF–æs£‡‚ƒ¶&÷&FW"×F÷£‚6öÆ–Bf"‚ÒÖ&÷&FW#"’#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£—ƒ¶föçB×vV–v‡C£s·FW‡B×G&ç6f÷&Ó§WW&66S¶6öÆ÷#§f"‚Ò×FW‡C2“¶Ö&v–âÖ&÷GFöÓ£g‚#äW‡G&2ò–ç7VÖ÷2Ç7â7G–ÆSÒ&föçB×vV–v‡C£C¶6öÆ÷#§f"‚Ò×FW‡C2’#â‡RÒ÷"–W¦+rfÆBÒ6÷7Fòf–¦ò“Â÷7ããÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVB†WFòÖf–ÆÂÆÖ–æÖ‚ƒ“W‚Ãg"’“¶v£W‚#âG¶W‡G&4–çWG7ÓÂöF—cà¢ÂöF—cà¢ÆF—b7G–ÆSÒ'FF–æs£g‚ƒ¶&÷&FW"×F÷£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&6¶w&÷VæC§f"‚Ò×7W&f6S2“¶F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC¦fÆW‚ÖVæC¶v£gƒ¶Æ–vâÖ—FV×3¦6VçFW#¶föçB×6—¦S£ƒ¶fÆW‚×w&§w&#à¢Ç7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2’#ä6÷7Fó¢Ç7G&öær–CÒ&36B×Ö6÷7FòÒG¶–GÒ"7G–ÆSÒ&föçBÖfÖ–Ç“¢t¦WD'&–ç2ÖöæòrÆÖöæ÷76R#âCÂ÷7G&öæsãÂ÷7ãà¢Ç7ãå&V6–òæWFó¢Ç7G&öær–CÒ&36B×ÖæWFòÒG¶–GÒ"7G–ÆSÒ&föçBÖfÖ–Ç“¢t¦WD'&–ç2ÖöæòrÆÖöæ÷76S¶6öÆ÷#§f"‚ÒÖ66VçB’#âCÂ÷7G&öæsãÂ÷7ãà¢Ç7ãåF÷FÂ2ô•d¢Ç7G&öær–CÒ&36B××F÷FÂÒG¶–GÒ"7G–ÆSÒ&föçBÖfÖ–Ç“¢t¦WD'&–ç2ÖöæòrÆÖöæ÷76S¶6öÆ÷#§f"‚ÒÖ66VçC2’#âCÂ÷7G&öæsãÂ÷7ãà¢ÂöF—cà¢ÂöF—cæ°¢Æ—7BæVæD6†–ÆB‡w&W"“°¢36EWFFTÆÂ‚“°§Ğ ¦gVæ7F–öâ36E&VÖ÷fU–W¦†–B—°¢36E–W¦47F—f3Ö36E–W¦47F—f2æf–ÇFW"‡ƒÓç‚ÓÖ–B“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v36B×–W¦Òr¶–B“òç&VÖ÷fR‚“°¢36EWFFTÆÂ‚“°§Ğ ¦gVæ7F–öâ36EWDÖDÆ&Â†–B—°¢6öç7BÖCÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v36B×ÖÖBÒr¶–B“òçfÇVWÇÂuÄ²s°¢6öç7BÆ&ÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v36B×ÖÖGVæ—BÒr¶–B“°¢–b†Æ&Â’Æ&ÂçFW‡D6öçFVçCÖÖCÓÓÒu&W6–æUbsòvÔÂs¢vrs°§Ğ ¦gVæ7F–öâ36D6Æ5–W¦†–B—°¢6öç7BÖD¶W“ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v36B×ÖÖBÒr¶–B“òçfÇVWÇÂuÄ²s°¢6öç7BÖCÔ34EôÔDU$”ÄU5¶ÖD¶W•×ÇÇ·&V6–ös£#ÆÖW&Ö£ã'Ó°¢6öç7BÖEG“×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v36B×ÖÖGG’Òr¶–B“òçfÇVR—ÇÃ°¢6öç7BG“ÔÖF‚æÖ‚ƒÇ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v36B××G’Òr¶–B“òçfÇVR—ÇÃ“°¢6öç7BÖ&vVãÒ‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v36BÖ’ÖÖ&vVâr“òçfÇVR—ÇÃcR’ó°¢6öç7B6÷7FôÖCÔÖF‚ç&÷VæB†ÖEG’¦ÖBç&V6–ör¢ƒ¶ÖBæÖW&Ö’“°¢ÆWB6÷7FôÖÓ°¢34EôÔT”ä2æf÷$V6‚†ÓÓç¶6öç7Bƒ×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v36B×ÒÒr¶–B²rÒr¶Òæ–B“òçfÇVR—ÇÃ¶6÷7FôÖ³ÔÖF‚ç&÷VæB†‚¦Òæ6÷7Fò“·Ò“°¢ÆWB6÷7FôW‡G&3Ó°¢34EôU…E$2æf÷$V6‚†SÓç°¢6öç7B6†³ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v36BÖW‚Òr¶–B²rÒr¶Ræ–B“°¢–b‚6†³òæ6†V6¶VB’&WGW&ã°¢–b†RçF—óÓÓÒwVæ—Br—¶6öç7BW‡EG“×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v36BÖW‡G’Òr¶–B²rÒr¶Ræ–B“òçfÇVR—ÇÇG“¶6÷7FôW‡G&2³ÔÖF‚ç&÷VæB†Ræ6÷7Fò¦W‡EG’“·Ğ¢VÇ6R6÷7FôW‡G&2³ÖRæ6÷7Fó°¢Ò“°¢6öç7B6÷7FõVæ—CÖ6÷7FôÖB¶6÷7FôÖ¶6÷7FôW‡G&3°¢6öç7BæWFõVæ—CÖÖ&vVãÃôÖF‚ç&÷VæB†6÷7FõVæ—BòƒÖÖ&vVâ’“¦6÷7FõVæ—C°¢&WGW&ç¶6÷7FõVæ—BÆæWFõVæ—BÆ6÷7FõF÷FÃ¦6÷7FõVæ—B§G’ÆæWFõF÷FÃ¦æWFõVæ—B§G’ÇF÷FÄ6öä—f¤ÖF‚ç&÷VæB†æWFõVæ—B§G’£ã’’ÇG—Ó°§Ğ ¦gVæ7F–öâ36EWFFTÆÂ‚—°¢6öç7BÖ&vVåfÃ×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v36BÖ’ÖÖ&vVâr“òçfÇVR—ÇÃcS°¢6öç7BÆ&ÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v36BÖ’ÖÖ&vVâÖÆ&Âr“°¢–b†Æ&Â’Æ&ÂçFW‡D6öçFVçCÖÖ&vVåfÂ²rRs°¢ÆWBw&æEF÷FÃÓ°¢36E–W¦47F—f2æf÷$V6‚†–CÓç°¢6öç7G¶6÷7FõF÷FÂÆæWFõF÷FÂÇF÷FÄ6öä—fÓÖ36D6Æ5–W¦†–B“°¢6öç7B6óÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v36B×Ö6÷7FòÒr¶–B“¶–b†6ò’6òçFW‡D6öçFVçCÖf÷&ÖD4Å†6÷7FõF÷FÂ“°¢6öç7BæSÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v36B×ÖæWFòÒr¶–B“¶–b†æR’æRçFW‡D6öçFVçCÖf÷&ÖD4Å†æWFõF÷FÂ“°¢6öç7BFóÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v36B××F÷FÂÒr¶–B“¶–b‡Fò’FòçFW‡D6öçFVçCÖf÷&ÖD4Å‡F÷FÄ6öä—f“°¢w&æEF÷FÂ³×F÷FÄ6öä—f°¢Ò“°¢6öç7BFVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v36BÖ’×F÷FÂr“¶–b‡FVÂ’FVÂçFW‡D6öçFVçCÖf÷&ÖD4Å†w&æEF÷FÂ“°§Ğ ¦gVæ7F–öâ36DÆ–6$6÷B‚—°¢–b‚36E–W¦47F—f2æÆVæwF‚—·Fö7B‚tw&VvÂÖVæ÷2Væ–W¦rÂvW'&÷"r“·&WGW&ã·Ğ¢36E–W¦47F—f2æf÷$V6‚†–CÓç°¢6öç7BFW63Ò†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v36B×ÖFW62Òr¶–B“òçfÇVWÇÂrr’çG&–Ò‚—ÇÂu–W¦–×&W6œ;6â4Bs°¢6öç7G¶6÷7FõVæ—BÆæWFõVæ—BÇG—ÓÖ36D6Æ5–W¦†–B“°¢6Æ4–ç6W'E&÷r†36EF&vWBÇ¶FW62ÇVæC§G’Æ6÷7FõVæ—BÇfVçFVæ—C¦æWFõVæ—GÒ“°¢Ò“°¢6öç7B6÷VçCÖ36E–W¦47F—f2æÆVæwFƒ°¢36E–W¦47F—f3ÕµÓ¶36E–W¦6÷VçFW#Ó°¢6öç7BÆ—7CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v36BÖ’×–W¦2r“¶–b‡Æ—7B’Æ—7Bæ–ææW$…DÔÃÒrs°¢6öç7BFVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v36BÖ’×F÷FÂr“¶–b‡FVÂ’FVÂçFW‡D6öçFVçCÒrCs°¢6öç7BæVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v36BÖ–æÆ–æR×æVÂr“¶–b‡æVÂ’æVÂç7G–ÆRæF—7Æ“ÒvæöæRs°¢ö&¦V7BçfÇVW2…ö36D'Fç2‚’’æf÷$V6‚†#Óç¶–b†"–"ç7G–ÆRæ&6¶w&÷VæCÒrs·Ò“°¢Fö7B†6÷VçB²r–W¦r²†6÷VçBÓÓòw2s¢rr’²rw&VvFr²†6÷VçBÓÓòw2s¢rr’²rÆ6÷F—¦6œ;6â)É2rÂw7V66W72r“°§Ğ ¢òò¶VW7GV"6òöÆB&öö¶Ö&¶VB6ÆÇ2FöâwB7&6€¦gVæ7F–öâ6Æ36D–æ—B‚—·Ğ ¦gVæ7F–öâFövvÆTçVWfôÖVçR†R—°¢Rç7F÷&÷vF–öâ‚“°¢6öç7BæVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vçVWfôG&÷æVÂr“°¢6öç7B'FãÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vçVWfôG&÷'Fâr“°¢6öç7B'&÷sÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vçVWfôG&÷'&÷rr“°¢6öç7B—4÷Vã×æVÂç7G–ÆRæF—7Æ’ÓÒvæöæRs°¢–b†—4÷Vâ—°¢æVÂç7G–ÆRæF—7Æ“ÒvæöæRs°¢–b†'&÷r–'&÷rç7G–ÆRçG&ç6f÷&ÓÒw&÷FFRƒFVr’s°¢ÒVÇ6R°¢6öç7B&V7CÖ'FâævWD&÷VæF–æt6Æ–VçE&V7B‚“°¢æVÂç7G–ÆRçF÷Ò‡&V7Bæ&÷GFöÒ³‚’²w‚s°¢æVÂç7G–ÆRç&–v‡CÒ‡v–æF÷ræ–ææW%v–GF‚×&V7Bç&–v‡B’²w‚s°¢æVÂç7G–ÆRæÆVgCÒvWFòs°¢æVÂç7G–ÆRæF—7Æ“Òv&Æö6²s°¢–b†'&÷r–'&÷rç7G–ÆRçG&ç6f÷&ÓÒw&÷FFRƒƒFVr’s°¢Ğ§Ğ¦gVæ7F–öâFövvÆTçVWfôÖVçTÖö&–ÆR†R—°¢Rç7F÷&÷vF–öâ‚“°¢6öç7BæVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vçVWfôG&÷æVÂr“°¢6öç7B'FãÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖö&–ÆUÇW4'Fâr“°¢–b‚æVÇÇÂ'Fâ’&WGW&ã°¢òò6çVWfôG&÷F÷vâ†2F—7Æ“¦æöæR–×÷'FçBöâÖö&–ÆRÂv†–6‚†–FW2—G26†–ÆG&Và¢òòWfVâv†VâF†W’†fR÷6—F–öã¦f—†VBâÖ÷fRæVÂFòÆ&öG“âFòW66RF†Bà¢–b‡æVÂç&VçDVÆVÖVçBÓÖFö7VÖVçBæ&öG’’Fö7VÖVçBæ&öG’æVæD6†–ÆB‡æVÂ“°¢6öç7B—4÷Vã×æVÂç7G–ÆRæF—7Æ’ÓÒvæöæRs°¢–b†—4÷Vâ—·æVÂç7G–ÆRæF—7Æ“ÒvæöæRs·Ğ¢VÇ6W°¢6öç7B&V7CÖ'FâævWD&÷VæF–æt6Æ–VçE&V7B‚“°¢æVÂç7G–ÆRçF÷Ò‡&V7Bæ&÷GFöÒ³b’²w‚s°¢æVÂç7G–ÆRæÆVgCÔÖF‚æÖ‚ƒ‚Ç&V7BæÆVgBÓ’²w‚s°¢æVÂç7G–ÆRç&–v‡CÒvWFòs°¢æVÂç7G–ÆRæF—7Æ“Òv&Æö6²s°¢Ğ§Ğ¦gVæ7F–öâ6Æ÷6TçVWfôÖVçR‚—°¢6öç7BæVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vçVWfôG&÷æVÂr“°¢6öç7B'&÷sÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vçVWfôG&÷'&÷rr“°¢–b‡æVÂ—æVÂç7G–ÆRæF—7Æ“ÒvæöæRs°¢–b†'&÷r–'&÷rç7G–ÆRçG&ç6f÷&ÓÒw&÷FFRƒFVr’s°§Ğ¦gVæ7F–öâFövvÆTÖö&–ÆTçVWfò‚—°¢6öç7B&öG“ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖö&–ÆTçVWfô&öG’r“°¢6öç7B6†Wg&öãÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖö&–ÆTçVWfô6†Wg&öâr“°¢6öç7B—4÷VãÖ&öG’bf&öG’ç7G–ÆRæF—7Æ’ÓÒvæöæRs°¢–b†&öG’–&öG’ç7G–ÆRæF—7Æ“Ö—4÷VãòvæöæRs¢v&Æö6²s°¢–b†6†Wg&öâ–6†Wg&öâç7G–ÆRçG&ç6f÷&ÓÖ—4÷Vãòw&÷FFRƒFVr’s¢w&÷FFRƒƒFVr’s°§Ğ¦gVæ7F–öâFövvÆTÖö&–ÆT6öæf–r‚—°¢6öç7B&öG“ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖö&–ÆT6öæf–t&öG’r“°¢6öç7B6†Wg&öãÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖö&–ÆT6öæf–t6†Wg&öâr“°¢6öç7B—4÷VãÖ&öG’bf&öG’ç7G–ÆRæF—7Æ’ÓÒvæöæRs°¢–b†&öG’–&öG’ç7G–ÆRæF—7Æ“Ö—4÷VãòvæöæRs¢vfÆW‚s°¢–b†6†Wg&öâ–6†Wg&öâç7G–ÆRçG&ç6f÷&ÓÖ—4÷Vãòw&÷FFRƒFVr’s¢w&÷FFRƒƒFVr’s°¢–b‚—4÷Vâ’÷VÆFTÖö&–ÆT6öæf–r‚“°§Ğ¦gVæ7F–öâ÷VÆFTÖö&–ÆT6öæf–r‚—°¢6öç7BCÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$—'F&ÆUFö¶Vâr“°¢–b†B—¶6öç7BcÖÇ4vWB‚v—'F&ÆU÷Fö¶Vâr“¶BçfÇVS×cò~(
.(
.(
.(
.(
.(
.(
.(
"r·bç6Æ–6R‚ÓB“¢rs¶BçÆ6V†öÆFW#×còr†wV&FFò’s¢wE……‚âââs¶Bæöæfö7W3Ò‚“Óç¶–b†BçfÇVRç7F'G5v—F‚‚~(
.(
"r’—¶BçfÇVSÒrs¶BçÆ6V†öÆFW#ÒwE……‚âââs·×Ó¶Bæöæ&ÇW#Ò‚“Óç¶–b‚BçfÇVR—¶6öç7BgcÖÇ4vWB‚v—'F&ÆU÷Fö¶Vâr“¶BçfÇVS×gcò~(
.(
.(
.(
.(
.(
.(
.(
"r·gbç6Æ–6R‚ÓB“¢rs¶BçÆ6V†öÆFW#×gcòr†wV&FFò’s¢wE……‚âââs·××Ğ¢6öç7Bö“ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$÷Væ”¶W’r“°¢–b†ö’—¶6öç7BcÖÆö6Å7F÷&vRævWD—FVÒ‚vgö÷Væ•ö¶W’r“¶ö’çfÇVSÒrs¶ö’çÆ6V†öÆFW#×còr†wV&FF(	BW67&–&RçVWf&6Ö&–"’s¢w6²×&ö¢Òâââs·Ğ¢6öç7Bv3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$vöövÆT6Æ–VçD–Br“°¢–b†v2—¶6öç7BcÖÆö6Å7F÷&vRævWD—FVÒ‚vvöövÆUöG&—fUö6Æ–VçEö–Br—ÇÂrs¶v2çfÇVS×c÷bç6Æ–6RƒÃ"’²~(
br·bç6Æ–6R‚Ó‚“¢rs·Ğ¢6öç7BG3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$G&—fU7FGW2r“°¢–b†G2—¶6öç7BcÖÆö6Å7F÷&vRævWD—FVÒ‚vvöövÆUöG&—fUö6Æ–VçEö–Br“¶G2çFW‡D6öçFVçC×cò~)É26Æ–VçB”B6öæf–wW&Fòs¢u6–â6öæf–wW&"s·Ğ¢6öç7BSÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ%&÷‡•W&Âr“¶–b‡R’RçfÇVSÖÆö6Å7F÷&vRævWD—FVÒ‚w&÷‡•÷W&Âr—ÇÂrs°¢6öç7B³ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ%&÷‡”¶W’r“°¢–b‡²—¶6öç7BcÖÆö6Å7F÷&vRævWD—FVÒ‚w&÷‡•ö¶W’r“·²çfÇVS×cò~(
.(
.(
.(
.(
.(
.(
.(
"r·bç6Æ–6R‚ÓB“¢rs·²æöæfö7W3Ò‚“Óç¶–b‡²çfÇVRç7F'G5v—F‚‚~(
.(
"r’—·²çfÇVSÒrs·²çÆ6V†öÆFW#Òv6ÆfR×6V7&WFs·×Ó·²æöæ&ÇW#Ò‚“Óç¶–b‚²çfÇVR—¶6öç7BgcÖÆö6Å7F÷&vRævWD—FVÒ‚w&÷‡•ö¶W’r“·²çfÇVS×gcò~(
.(
.(
.(
.(
.(
.(
.(
"r·gbç6Æ–6R‚ÓB“¢rs·×Ó·Ğ¢6öç7B3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ%&÷‡•7FGW2r“°¢–b‡2—¶6öç7BcÒ‡G—Vöb÷&÷‡”6fsÓÓÒvgVæ7F–öâr’be÷&÷‡”6fr‚“·2çFW‡D6öçFVçC×cò~)É2&÷‡’7F—fòs¢u6–â&÷‡’(	BFö¶VâÆö6Âs·Ğ¢6öç7BCÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ%&–çFW%GVææVÂr“¶–b‡B’BçfÇVSÖÆö6Å7F÷&vRævWD—FVÒ‚w&–çFW%÷GVææVÂr—ÇÂrs°¢6öç7BF³ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ%&–çFW%Fö¶Vâr“¶–b‡F²—¶6öç7BcÖÆö6Å7F÷&vRævWD—FVÒ‚w&–çFW%÷GVææVÅ÷Fö¶Vâr“·F²çfÇVS×cò~(
.(
.(
.(
.(
.(
.(
.(
"r·bç6Æ–6R‚ÓB“¢rs·F²æöæfö7W3Ò‚“Óç¶–b‡F²çfÇVRç7F'G5v—F‚‚~(
.(
"r’—F²çfÇVSÒrs·Ó·F²æöæ&ÇW#Ò‚“Óç¶–b‚F²çfÇVR—¶6öç7BgcÖÆö6Å7F÷&vRævWD—FVÒ‚w&–çFW%÷GVææVÅ÷Fö¶Vâr“·F²çfÇVS×gcò~(
.(
.(
.(
.(
.(
.(
.(
"r·gbç6Æ–6R‚ÓB“¢rs·×Ó·Ğ¢6öç7BG3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ%&–çFW%GVææVÅ7FGW2r“°¢–b‡G2—¶6öç7BcÖÆö6Å7F÷&vRævWD—FVÒ‚w&–çFW%÷GVææVÂr“·G2çFW‡D6öçFVçCÒ‡cò~)É2r·c¢tFVfVÇC¢‡GG3¢ò÷&–çFW'2çF†VÆ"ç6öÇWF–öç2r’²†Æö6Å7F÷&vRævWD—FVÒ‚w&–çFW%÷GVææVÅ÷Fö¶Vâr“òr+r	ùIs¢rr“·Ğ¢6öç7B³ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$çF‡&÷–4¶W’r“°¢–b†²—¶6öç7BcÖÇ4vWB‚vçF‡&÷–5ö¶W’r“¶²çfÇVSÒrs¶²çÆ6V†öÆFW#×bbbbç7F'G5v—F‚‚rRRr“òr†wV&FF(	BW67&–&RçVWf&6Ö&–"’s¢w6²ÖçBÖ“2Òâââs·Ğ¢6öç7B·3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$çF‡&÷–57FGW2r“°¢–b†·2—¶6öç7BcÖÇ4vWB‚vçF‡&÷–5ö¶W’r“¶·2çFW‡D6öçFVçC×bbbbç7F'G5v—F‚‚rRRr“ò~)É2´’6öæV7FFòs¢u6–â6öæf–wW&"s·Ğ§Ğ¦gVæ7F–öâ6fTÖ$—'F&ÆUFö¶Vâ‚—°¢6öç7B–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$—'F&ÆUFö¶Vâr“¶6öç7BcÒ†–çòçfÇVWÇÂrr’çG&–Ò‚“°¢–b‚b—&WGW&âFö7B‚t–æw&W6VâFö¶Vâl:Æ–FòrÂvW'&÷"r“°¢Ç56WB‚v—'F&ÆU÷Fö¶VârÇb“¶–ççfÇVSÒ~(
.(
.(
.(
.(
.(
.(
.(
"r·bç6Æ–6R‚ÓB“°¢Fö7B‚uFö¶Vâ—'F&ÆRwV&FFò)É2rÂw7V66W72r“¶ÆöDÆÄFF‚“°§Ğ¦gVæ7F–öâ6ÆV$Ö$—'F&ÆUFö¶Vâ‚—°¢Æö6Å7F÷&vRç&VÖ÷fT—FVÒ‚v—'F&ÆU÷Fö¶Vâr“·6W76–öå7F÷&vRç&VÖ÷fT—FVÒ‚v—'F&ÆU÷Fö¶Vâr“°¢6öç7B–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$—'F&ÆUFö¶Vâr“¶–b†–ç—¶–ççfÇVSÒrs¶–ççÆ6V†öÆFW#ÒwE……‚âââs·Ğ¢Fö7B‚uFö¶Vâ—'F&ÆRVÆ–Ö–æFòrÂv–æfòr“°§Ğ¦gVæ7F–öâ6fTÖ$÷Væ”¶W’‚—°¢6öç7B–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$÷Væ”¶W’r“¶6öç7BcÒ†–çòçfÇVWÇÂrr’çG&–Ò‚“°¢–b‚b—°¢6öç7BW†—7F–æsÖÆö6Å7F÷&vRævWD—FVÒ‚vgö÷Væ•ö¶W’r“°¢&WGW&âFö7B†W†—7F–æsòt÷Vä’¶W’–W7L:6öæf–wW&Fs¢t–æw&W6Væ’¶W’l:Æ–FrÂW†—7F–æsòv–æfòs¢vW'&÷"r“°¢Ğ¢–b‡bç7F'G5v—F‚‚~(
"r’—&WGW&âFö7B‚t–æw&W6Æ¶W’6ö×ÆWFrÂvW'&÷"r“°¢Æö6Å7F÷&vRç6WD—FVÒ‚vgö÷Væ•ö¶W’rÇb“°¢–b†–ç—¶–ççfÇVSÒrs¶–ççÆ6V†öÆFW#Òr†wV&FF(	BW67&–&RçVWf&6Ö&–"’s·Ğ¢Fö7B‚t÷Vä’¶W’wV&FF)É2rÂw7V66W72r“°§Ğ¦gVæ7F–öâ6ÆV$Ö$÷Væ”¶W’‚—°¢Æö6Å7F÷&vRç&VÖ÷fT—FVÒ‚vgö÷Væ•ö¶W’r“°¢6öç7B–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$÷Væ”¶W’r“¶–b†–ç—¶–ççfÇVSÒrs¶–ççÆ6V†öÆFW#Òw6²×&ö¢Òâââs·Ğ¢Fö7B‚t÷Vä’¶W’VÆ–Ö–æFrÂv–æfòr“°§Ğ¦gVæ7F–öâ6fTÖ$vöövÆT6Æ–VçD–B‚—°¢6öç7B–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$vöövÆT6Æ–VçD–Br“¶6öç7BcÒ†–çòçfÇVWÇÂrr’çG&–Ò‚“°¢–b‚b—&WGW&âFö7B‚t–æw&W6Vâ6Æ–VçB”Bl:Æ–FòrÂvW'&÷"r“°¢Æö6Å7F÷&vRç6WD—FVÒ‚vvöövÆUöG&—fUö6Æ–VçEö–BrÇb“°¢6öç7BG3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$G&—fU7FGW2r“¶–b†G2’G2çFW‡D6öçFVçCÒ~)É26Æ–VçB”B6öæf–wW&Fòs°¢Fö7B‚tvöövÆRG&—fR6Æ–VçB”BwV&FFò)É2rÂw7V66W72r“°§Ğ¦gVæ7F–öâ6ÆV$Ö$vöövÆT6Æ–VçD–B‚—°¢Æö6Å7F÷&vRç&VÖ÷fT—FVÒ‚vvöövÆUöG&—fUö6Æ–VçEö–Br“µöG&—fUFö¶Vä6Æ–VçCÖçVÆÃµöG&—fT66W75Fö¶VãÖçVÆÃ°¢6öç7B–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$vöövÆT6Æ–VçD–Br“¶–b†–ç’–ççfÇVSÒrs°¢6öç7BG3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$G&—fU7FGW2r“¶–b†G2’G2çFW‡D6öçFVçCÒu6–â6öæf–wW&"s°¢Fö7B‚tvöövÆR6Æ–VçB”BVÆ–Ö–æFòrÂv–æfòr“°§Ğ¦gVæ7F–öâ6fTÖ%&÷‡’‚—°¢6öç7BW&Ä–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ%&÷‡•W&Âr“¶6öç7B¶W”–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ%&÷‡”¶W’r“°¢6öç7BW&ÃÒ‡W&Ä–çòçfÇVWÇÂrr’çG&–Ò‚“¶6öç7B¶W“Ò†¶W”–çòçfÇVWÇÂrr’çG&–Ò‚“°¢–b‡W&Â’Æö6Å7F÷&vRç6WD—FVÒ‚w&÷‡•÷W&ÂrÇW&Â“²VÇ6RÆö6Å7F÷&vRç&VÖ÷fT—FVÒ‚w&÷‡•÷W&Âr“°¢–b†¶W’’Æö6Å7F÷&vRç6WD—FVÒ‚w&÷‡•ö¶W’rÆ¶W’“²VÇ6RÆö6Å7F÷&vRç&VÖ÷fT—FVÒ‚w&÷‡•ö¶W’r“°¢6öç7B3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ%&÷‡•7FGW2r“°¢–b‡2’2çFW‡D6öçFVçC×W&Ãò~)É2&÷‡’7F—fòs¢u6–â&÷‡’(	BFö¶VâÆö6Âs°¢Fö7B‡W&Ãòu&÷‡’v÷&¶W"wV&FFò)É2s¢u&÷‡’VÆ–Ö–æFòrÂw7V66W72r“°§Ğ¦gVæ7F–öâ6ÆV$Ö%&÷‡’‚—°¢Æö6Å7F÷&vRç&VÖ÷fT—FVÒ‚w&÷‡•÷W&Âr“¶Æö6Å7F÷&vRç&VÖ÷fT—FVÒ‚w&÷‡•ö¶W’r“°¢6öç7BW&Ä–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ%&÷‡•W&Âr“¶–b‡W&Ä–ç’W&Ä–ççfÇVSÒrs°¢6öç7B¶W”–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ%&÷‡”¶W’r“¶–b†¶W”–ç’¶W”–ççfÇVSÒrs°¢6öç7B3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ%&÷‡•7FGW2r“¶–b‡2’2çFW‡D6öçFVçCÒu6–â&÷‡’(	BFö¶VâÆö6Âs°¢Fö7B‚u&÷‡’VÆ–Ö–æFòrÂv–æfòr“°§Ğ¦gVæ7F–öâ6fTÖ%&–çFW%GVææVÂ‚—°¢6öç7B–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ%&–çFW%GVææVÂr“¶6öç7BcÒ†–çòçfÇVWÇÂrr’çG&–Ò‚“°¢–b‡b’Æö6Å7F÷&vRç6WD—FVÒ‚w&–çFW%÷GVææVÂrÇb“²VÇ6RÆö6Å7F÷&vRç&VÖ÷fT—FVÒ‚w&–çFW%÷GVææVÂr“°¢6öç7BF´–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ%&–çFW%Fö¶Vâr“¶6öç7BF³Ò‡F´–çòçfÇVWÇÂrr’çG&–Ò‚“°¢–b‡F²bbF²ç7F'G5v—F‚‚~(
.(
"r’–Æö6Å7F÷&vRç6WD—FVÒ‚w&–çFW%÷GVææVÅ÷Fö¶VârÇF²“°¢VÇ6R–b‚F²–Æö6Å7F÷&vRç&VÖ÷fT—FVÒ‚w&–çFW%÷GVææVÅ÷Fö¶Vâr“°¢–b‡F´–çbgF²bbF²ç7F'G5v—F‚‚~(
.(
"r’—F´–ççfÇVSÒ~(
.(
.(
.(
.(
.(
.(
.(
"r·F²ç6Æ–6R‚ÓB“°¢6öç7BG3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ%&–çFW%GVææVÅ7FGW2r“°¢–b‡G2’G2çFW‡D6öçFVçCÒ‡cò~)É2r·c¢tFVfVÇC¢‡GG3¢ò÷&–çFW'2çF†VÆ"ç6öÇWF–öç2r’²†Æö6Å7F÷&vRævWD—FVÒ‚w&–çFW%÷GVææVÅ÷Fö¶Vâr“òr+r	ùIs¢rr“°¢Fö7B‡còuL;¦æVÂwV&FFò)É2s¢uL;¦æVÂ&W7F&ÆV6–FòÂFVfVÇBrÂw7V66W72r“°¢–b‡G—VöböÆÅ&–çFW'3ÓÓÒvgVæ7F–öâr—öÆÅ&–çFW'2‚“°§Ğ¦gVæ7F–öâ6ÆV$Ö%&–çFW%GVææVÂ‚—°¢Æö6Å7F÷&vRç&VÖ÷fT—FVÒ‚w&–çFW%÷GVææVÂr“°¢Æö6Å7F÷&vRç&VÖ÷fT—FVÒ‚w&–çFW%÷GVææVÅ÷Fö¶Vâr“°¢6öç7B–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ%&–çFW%GVææVÂr“¶–b†–ç’–ççfÇVSÒrs°¢6öç7BF´–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ%&–çFW%Fö¶Vâr“¶–b‡F´–ç’F´–ççfÇVSÒrs°¢6öç7BG3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ%&–çFW%GVææVÅ7FGW2r“¶–b‡G2’G2çFW‡D6öçFVçCÒtFVfVÇC¢‡GG3¢ò÷&–çFW'2çF†VÆ"ç6öÇWF–öç2s°¢Fö7B‚uL;¦æVÂ&W7F&ÆV6–FòÂFVfVÇBrÂv–æfòr“°§Ğ¦gVæ7F–öâ6fTÖ$çF‡&÷–4¶W’‚—°¢6öç7B–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$çF‡&÷–4¶W’r“¶6öç7BcÒ†–çòçfÇVWÇÂrr’çG&–Ò‚“°¢–b‚b—°¢6öç7BW†—7F–æsÖÇ4vWB‚vçF‡&÷–5ö¶W’r“°¢–b†W†—7F–ærbbW†—7F–ærç7F'G5v—F‚‚rRRr’’Fö7B‚t´’–F–VæRVæ¶W’6öæf–wW&FrÂv–æfòr“°¢VÇ6RFö7B‚t–æw&W6Væ’¶W’FRçF‡&÷–2rÂvW'&÷"r“°¢&WGW&ã°¢Ğ¢–b‡bç7F'G5v—F‚‚~(
"r’—·Fö7B‚t–æw&W6Æ¶W’6ö×ÆWFÂæòVÂfÆ÷"VæÖ66&FòrÂvW'&÷"r“·&WGW&ã·Ğ¢Ç56WB‚vçF‡&÷–5ö¶W’rÇb“°¢–b†–ç—¶–ççfÇVSÒrs¶–ççÆ6V†öÆFW#Òr†wV&FF(	BW67&–&RçVWf&6Ö&–"’s·Ğ¢6öç7B7CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$çF‡&÷–57FGW2r“¶–b‡7B’7BçFW‡D6öçFVçCÒ~)É2´’6öæV7FFòs°¢Fö7B‚~)É2´’’¶W’wV&FFrÂw7V66W72r“°§Ğ¦gVæ7F–öâ6ÆV$Ö$çF‡&÷–4¶W’‚—°¢Ç56WB‚vçF‡&÷–5ö¶W’rÂrr“°¢6öç7B–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$çF‡&÷–4¶W’r“¶–b†–ç—¶–ççfÇVSÒrs¶–ççÆ6V†öÆFW#Òw6²ÖçBÖ“2Òâââs·Ğ¢6öç7B7CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$çF‡&÷–57FGW2r“¶–b‡7B’7BçFW‡D6öçFVçCÒu6–â6öæf–wW&"s°¢Fö7B‚t´’’¶W’VÆ–Ö–æFrÂv–æfòr“°§Ğ¦gVæ7F–öâ6fTÖ$VÆWfVäÆ'4¶W’‚—°¢6öç7B–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$VÆWfVäÆ'4¶W’r“¶6öç7BcÒ†–çòçfÇVWÇÂrr’çG&–Ò‚“°¢–b‚b—·Fö7B‚t–æw&W6Væ’¶W’FRVÆWfVäÆ'2rÂvW'&÷"r“·&WGW&ã·Ğ¢Æö6Å7F÷&vRç6WD—FVÒ‚vVÆWfVæÆ'5ö¶W’rÇb“°¢–b†–ç—¶–ççfÇVSÒrs¶–ççÆ6V†öÆFW#ÒtwV&FF)É2s·Ğ¢6öç7B7CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$VÆWfVäÆ'57FGW2r“¶–b‡7B’7BçFW‡D6öçFVçCÒ~)É2f÷¢VÆWfVäÆ'27F—fs°¢Fö7B‚~)É2VÆWfVäÆ'2¶W’wV&FFrÂw7V66W72r“°§Ğ¦gVæ7F–öâ6ÆV$Ö$VÆWfVäÆ'4¶W’‚—°¢Æö6Å7F÷&vRç&VÖ÷fT—FVÒ‚vVÆWfVæÆ'5ö¶W’r“°¢6öç7B–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$VÆWfVäÆ'4¶W’r“¶–b†–ç—¶–ççfÇVSÒrs¶–ççÆ6V†öÆFW#Òw6µòâââs·Ğ¢6öç7B7CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ$VÆWfVäÆ'57FGW2r“¶–b‡7B’7BçFW‡D6öçFVçCÒu6–â6öæf–wW&"s°¢Fö7B‚tVÆWfVäÆ'2¶W’VÆ–Ö–æFrÂv–æfòr“°§Ğ¦Fö7VÖVçBæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÆgVæ7F–öâ†R—°¢6öç7BFCÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vçVWfôG&÷F÷vâr“°¢–b†FBbbFBæ6öçF–ç2†RçF&vWB’–6Æ÷6TçVWfôÖVçR‚“°§Ò“° ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò,9¥5TTDtÄô$Â†6öÖÖæBÆWGFR(	B6V66–öæW2Â66–öæW2’FF÷2¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦ÆWBöw5&W7VÇG3ÕµÓ²òògVæ6–öæW2V¦V7WF"Â–æFW†F2‡&FV6ÆFò¦ÆWBöw4W‡G&3ÕµÓ²òò66–öæW26V7VæF&–2÷"f–Æ†6†—2’ÂgVW&FVÂ6–6ÆòFRFV6ÆFğ¦ÆWBöw47F—fSÒÓ²òò:ÖæF–6R7F—fò†æfVv6œ;6â6öâfÆV6†2¦ÆWBöw4–æ—FVCÖfÇ6S° ¦6öç7Bu5õ4T5D”ôå3Õ°¢·F#¢v÷fW'f–WrrÂ–6öã¢v–6öâÖ÷fW'f–WrrÂ3¢r3CF62rÇF—FÆS¢t÷fW'f–WrrÂ·s¢v–æ–6–ò&W7VÖVâ6VçG&ò6öÖæFòF6†&ö&BæVÂvVæW&Â†öÖRwÒÀ¢·F#¢v6Æ–VçFW2rÂ–6öã¢v–6öâÖ6Æ–VçFW2rÂ3¢r36#ƒ&cbrÇF—FÆS¢t6Æ–VçFW2rÂ·s¢v7&Ò6öçF7F÷2V×&W62ÆVG2wÒÀ¢·F#¢v6÷F—¦6–öæW2rÂ–6öã¢v–6öâÖ6÷F—¦6–öæW2rÂ3¢r6s†&frÇF—FÆS¢t6÷F—¦6–öæW2rÂ·s¢w&W7WVW7F÷26÷F—¦"öfW'F2V÷FW2wÒÀ¢·F#¢wVF–F÷2rÂ–6öã¢v–6öâ×VF–F÷2rÂ3¢r6fcf#3RrÇF—FÆS¢uVF–F÷2rÂ·s¢v÷&FVæW2&öGV66–öâFW76†òfVçF2wÒÀ¢·F#¢w&÷fVVF÷&W2rÂ–6öã¢v–6öâ×&÷fVVF÷&W2rÂ3¢r6ffrÇF—FÆS¢u&÷fVVF÷&W2rÂ·s¢w7WÆ–W'26ö×&2–ç7VÖ÷2wÒÀ¢·F#¢vvVçFW2rÂ–6öã¢v–6öâÖvVçFW2rÂ3¢r3#“ƒrÇF—FÆS¢tvVçFW2”rÂ·s¢v–’¶’WFöÖF—¦6–öâ&÷G26—7FVçFW2wÒÀ¢·F#¢vÖV–æ2rÂ–6öã¢v–6öâÖÖV–æ2rÂ3¢r6fcCCCBrÇF—FÆS¢tÜ:V–æ2rÂ·s¢v–×&W6÷&26B&–çFW'2Ööæ—F÷"66–FBwÒÀ¢·F#¢vWV—òrÂ–6öã¢v–6öâÖWV—òrÂ3¢r6cCs&#brÇF—FÆS¢tWV—òrÂ·s¢wW'6öæ27Ffb6ÆVæF&–òGW&æ÷2'&†‚wÒÀ¢·F#¢w&W÷'FRrÂ–6öã¢v–6öâ×&W÷'FRrÂ3¢r3F#†brÇF—FÆS¢u&W÷'FW2rÂ·s¢væÆ—F–6W7FF—7F–62ÖWG&–62–æf÷&ÖW2wÒÀ¢·F#¢wvV"rÂ–6öã¢v–6öâ×vV"rÂ3¢r3c3cfcrÇF—FÆS¢uvV"rÂ·s¢wv÷&G&W72vöövÆRG26Vò6—F–òÖ&¶WF–ærwÒÀ¢·F#¢vf–æç¦2rÂ–6öã¢v–6öâÖf–æç¦2rÂ3¢r3#&3SVRrÇF—FÆS¢tf–æç¦2rÂ·s¢vf7GW&2GFR6–’6¦fÇV¦òF–æW&ò6öçF&–Æ–FBwÒÀ¢·F#¢wf—7VÂrÂ–6öã¢v–6öâ×f—7VÂrÂ3¢r3†#V6cbrÇF—FÆS¢uf—7VÂ’rÂ·s¢v–ÖvVæW2&VæFW"F—6VæòvVæW&F÷"wÒÀ¢·F#¢w&V×VæW&6–öæW2rÆ–6öã¢v–6öâ×&V×VæW&6–öæW2rÂ3¢r3ƒF63brÇF—FÆS¢u&V×VæW&6–öæW2rÂ·s¢w7VVÆF÷2v÷2æöÖ–æ2Æ—V–F6–öæW2'&†‚wÒÀ¢·F#¢w&VFW2rÂ–6öã¢v–6öâ×&VFW2rÂ3¢r6V3Cƒ“’rÇF—FÆS¢u&VFW26ö6–ÆW2rÂ·s¢v–ç7Fw&ÒF–·Fö²Æ–æ¶VF–âf6V&öö²6ö6–ÂÖVF–6öçFVæ–Fò6ÆVæF&–ò÷7G26ö×Væ–FBwÒÀ¥Ó°¦6öç7Bu5ô5D”ôå3Õ°¢¶çVWfó¢vçVWfòÖÆVBrÂ–6öã¢v–6öâ×W6W"×ÇW2rÂF—FÆS¢tçVWfòÆVBò6Æ–VçFRrÂ·s¢v7&V"w&Vv"çVWfò6Æ–VçFR6öçF7FòÆVBrÂ'Vã¢‚“Óç7v—F6…F"‚vçVWfòÖÆVBr—ÒÀ¢¶çVWfó¢vçVWfò×&÷fVVF÷"rÆ–6öã¢v–6öâ×&÷fVVF÷&W2rÂF—FÆS¢tçVWfò&÷fVVF÷"rÂ·s¢v7&V"w&Vv"&÷fVVF÷"rÂ'Vã¢‚“Óç7v—F6…F"‚vçVWfò×&÷fVVF÷"r—ÒÀ¢¶çVWfó¢vçVWfÖ6÷BrÂ–6öã¢v–6öâÖ6÷F—¦6–öæW2rÂF—FÆS¢tçVWf6÷F—¦6œ;6ârÂ·s¢v7&V"6÷F—¦"&W7WVW7FòrÂ'Vã¢‚“Óç7v—F6…F"‚vçVWfÖ6÷Br—ÒÀ¢¶çVWfó¢vçVWf×fVçFrÂ–6öã¢v–6öâ×G&VæF–ærrÂF—FÆS¢tçVWffVçFrÂ·s¢w&Vv—7G&"fVçF–æw&W6òrÂ'Vã¢‚“Óç·G'—¶—$çVWffVçF‚“·Ö6F6‚†R—·××ÒÀ¢¶çVWfó¢vÆ–'&òÖF–&–òrÂ–6öã¢v–6öâÖ&öö²rÂF—FÆS¢tçVWfò&Vv—7G&ò„F–&–ò’rÂ·s¢vÆ–'&òF–&–ò6öçF&–Æ–FB6–VçFòrÂ'Vã¢‚“Óç·G'—¶—$Æ–'&ôF–&–ò‚“·Ö6F6‚†R—·××ÒÀ¢¶–6öã¢v–6öâ×&Vg&W6‚rÂF—FÆS¢t7GVÆ—¦"FF÷2rÂ·s¢w&Vg&W66"&V6&v"7–æ26–æ7&öæ—¦"WFFRrÂ'Vã¢‚“Óç·G'—¶ÆöDÆÄFF‚“·Ö6F6‚†R—·××ÒÀ¢¶–6öã¢v–6öâ×6WGF–æw2rÂF—FÆS¢tÖ’7VVçFò6öæf–wW&6œ;6ârÂ·s¢v§W7FW2Fö¶Vç2’¶W—26öæf–r7VVçFrÂ'Vã¢‚“Óç·G'—¶÷VåW6W$ÖVçR‚“·Ö6F6‚†R—·××ÒÀ¢·F#¢v6÷F—¦6–öæW2rÆ–6öã¢v–6öâÖ6÷'&VòrÂF—FÆS¢u6VwV–Ö–VçF÷2VæF–VçFW2rÂ·s¢w6VwV–Ö–VçFòföÆÆ÷wW&æFV¦6÷F—¦6–öæW26–â&W7VW7FrÂ'Vã¢‚“Óç·7v—F6…F"‚v6÷F—¦6–öæW2r“·6WEF–ÖV÷WB‚‚“Óç·G'—¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚vgUG&”6&Br“òç67&öÆÄ–çFõf–Wr‡¶&V†f–÷#¢w6Öö÷F‚wÒ“·Ö6F6‚†R—·×ÒÃ3“·×ÒÀ¢·F#¢vf–æç¦2rÂ–6öã¢v–6öâÖFöÆÆ"rÂF—FÆS¢t6ö'&ç¦VæF–VçFRrÂ·s¢v6ö'&"6ö'&ç¦f7GW&2fVæ6–F2Ö÷&FWVFrÂ'Vã¢‚“Óç·7v—F6…F"‚vf–æç¦2r“·6WEF–ÖV÷WB‚‚“Óç·G'—¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚vf–ä6ö'&ç¦7F–öç2r“òç67&öÆÄ–çFõf–Wr‡¶&V†f–÷#¢w6Öö÷F‚wÒ“·Ö6F6‚†R—·×ÒÃ3“·×ÒÀ¢·F#¢v6Æ–VçFW2rÂ–6öã¢v–6öâ×&WVBrÂF—FÆS¢tÆVG2F÷&Ö–F÷2‡v–âÖ&6²’rÂ·s¢vF÷&Ö–F÷2–æ7F—f÷2&V7F—f"v–æ&6²&V6öæV7F"rÂ'Vã¢‚“Óç·7v—F6…F"‚v6Æ–VçFW2r“·6WEF–ÖV÷WB‚‚“Óç·G'—¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚wv%G&”6&Br“òç67&öÆÄ–çFõf–Wr‡¶&V†f–÷#¢w6Öö÷F‚wÒ“·Ö6F6‚†R—·×ÒÃ3“·×ÒÀ¢·F#¢wVF–F÷2rÂ–6öã¢v–6öâ×6VæBrÂF—FÆS¢u÷7BÖVçG&VvVæF–VçFW2rÂ·s¢w÷7BVçG&Vv6F—6f66–öâ&W6Væ&Wf–Wrf–FVÆ—¦"rÂ'Vã¢‚“Óç·7v—F6…F"‚wVF–F÷2r“·6WEF–ÖV÷WB‚‚“Óç·G'—¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚wEG&”6&Br“òç67&öÆÄ–çFõf–Wr‡¶&V†f–÷#¢w6Öö÷F‚wÒ“·Ö6F6‚†R—·×ÒÃ3“·×ÒÀ¢·F#¢wVF–F÷2rÂ–6öã¢v–6öâ×v&æ–ærrÂF—FÆS¢ufW"VF–F÷2G&6F÷2rÂ·s¢vG&6F÷2&WG&6òW&vVçFRVæF–VçFW2rÂ'Vã¢‚“Óç·7v—F6…F"‚wVF–F÷2r“·6WEF–ÖV÷WB‚‚“Óç·G'—·&VæFW%VF–F÷2‚vG&6F÷2r“·Ö6F6‚†R—·×ÒÃ#“·×ÒÀ¢·F#¢v÷fW'f–WrrÂ–6öã¢v–6öâÖ6†'BrÂF—FÆS¢tvVæW&"&W÷'FR4TòrÂ·s¢w&W÷'FR6VòV¦V7WF—fò–vVæW&"6VÖæÂæÆ—6—2rÂ'Vã¢‚“Óç·7v—F6…F"‚v÷fW'f–Wrr“·6WEF–ÖV÷WB‚‚“Óç·G'—¶÷dvVæW&%&W÷'FT4Tò‚“·Ö6F6‚†R—·×ÒÃ3“·×ÒÀ¢·F#¢v÷fW'f–WrrÂ–6öã¢v–6öâ×F&vWBrÂF—FÆS¢tFVf–æ—"ÖWF2FR&WfVçVRrÂ·s¢vÖWFö&¦WF—fòÖVç7VÂ6VÖæÂ&÷–V66–öâvöÂrÂ'Vã¢‚“Óç·7v—F6…F"‚v÷fW'f–Wrr“·6WEF–ÖV÷WB‚‚“Óç·G'—¶÷VäÖWFÖöFÂ‚“·Ö6F6‚†R—·×ÒÃ#S“·×ÒÀ¢¶6öæf–s§G'VRÂ–6öã¢v–6öâÖF÷væÆöBrÂF—FÆS¢u&W7ÆF"5$Ò†÷&rÂ·s¢v&6·W&W7ÆFò—'F&ÆR6÷–6VwW&–FBrÂ'Vã¢‚“Óç·G'—¶&6·W—'F&ÆR‚“·Ö6F6‚†R—·××ÒÀ¢¶–6öã¢v–6öâÖ6†BrÂF—FÆS¢t'&—"´’†6—7FVçFR’rÂ·s¢v¶’6—7FVçFR6†B–—VF†&Æ"rÂ'Vã¢‚“Óç·G'—¶÷Vä¶’‚“·Ö6F6‚†R—·××ÒÀ¢·F#¢vÖV–æ2rÂ–6öã¢v–6öâÖÆF÷rÂF—FÆS¢tÖöFòEb‡FÆÆW"’rÂ·s¢wGbFÆÆW"çFÆÆgVÆÇ67&VVâÖöæ—F÷"¶–÷66ò&÷F6–öârÂ'Vã¢‚“Óç·G'—·Ge7F'B‚“·Ö6F6‚†R—·××ÒÀ¢¶–6öã¢v–6öâÖ6ÆVæF"rÂF—FÆS¢tvVæF"6ö×&öÖ—6òrÂ·s¢vvVæF6ö×&öÖ—6ò&V6÷&FF÷&–òF&VVæF–VçFRfV6†ÆÆÖ"rÂ'Vã¢‚“Óç·G'—¶÷VävVæFÖöFÂ‚“·Ö6F6‚†R—·××ÒÀ¢·F#¢v÷fW'f–WrrÆ–6öã¢v–6öâ×&W÷'FRrÂF—FÆS¢tVçf–"6–W'&RFRÖW2÷"6÷'&VòrÂ·s¢v6–W'&RÖW2–æf÷&ÖRÖVç7VÂV¦V7WF—fò&WfVçVRVçf–"&W÷'FRrÂ'Vã¢‚“Óç·G'—¶Vçf–$6–W'&TÖW2‚“·Ö6F6‚†R—·××ÒÀ¢·F#¢v÷fW'f–WrrÆ–6öã¢v–6öâ×&W÷'FRrÂF—FÆS¢uDbV¦V7WF—fòFVÂ6–W'&RFRÖW2rÂ·s¢wFb6–W'&RÖW2–æf÷&ÖRV¦V7WF—fò–×&–Ö—"&W÷'FRFW66&v"6ö×'F—"rÂ'Vã¢‚“Óç·G'—¶vVæW&$6–W'&UDbƒ“·Ö6F6‚†R—·××ÒÀ¢·F#¢v÷fW'f–WrrÆ–6öã¢v–6öâ×&W÷'FRrÂF—FÆS¢tVçf–"&W7VÖVâ6VÖæÂ÷"6÷'&VòrÂ·s¢vF–vW7B&W7VÖVâ6VÖæÂ6VÖæ6÷'&VòVçf–"÷W&F—fò66–öæW2VæF–VçFW2rÂ'Vã¢‚“Óç·G'—¶Vçf–$F–vW7E6VÖæÂ‚“·Ö6F6‚†R—·××ÒÀ¢¶–6öã¢v–6öâ×VF–F÷2rÂF—FÆS¢t6L:ÆövòFR&öGV7F÷2rÂ·s¢v6FÆövò&öGV7F÷2&V6–ò&6R6W'f–6–÷2Æ—7F—FV×26÷F—¦"rÂ'Vã¢‚“Óç·G'—¶÷Vä6FÆövôÖöFÂ‚“·Ö6F6‚†R—·××ÒÀ¢·F#¢v6÷F—¦6–öæW2rÆ–6öã¢v–6öâÖ6÷F—¦6–öæW2rÂF—FÆS¢t6öæf–wW&"—6òFRÖ&vVârÂ·s¢vÖ&vVâÖ–æ–Öò—6ò&VçF&–Æ–FBÆW'F6÷F—¦6–öâ&V6–òö&¦WF—fòrÂ'Vã¢‚“Óç·G'—·6WDÖ&vVå—6ò‚“·Ö6F6‚†R—·××ÒÀ¢·F#¢wVF–F÷2rÆ–6öã¢v–6öâ×VF–F÷2rÂF—FÆS¢u&Vv—7G&"&V6ÆÖòòv&çL:ÖrÂ·s¢w&V6ÆÖòv&çF–÷7GfVçF&ÖFVfV7FòFWföÇV6–öâ&ö&ÆVÖVV¦rÂ'Vã¢‚“Óç·G'—¶÷Vå&V6ÆÖôÖöFÂ‚“·Ö6F6‚†R—·××ÒÀ¢·F#¢v6Æ–VçFW2rÆ–6öã¢v–6öâÖ6Æ–VçFW2rÂF—FÆS¢t6öçG&Fò&V7W'&VçFVÚ±î¸Â¸­yêë¢°k¢G§¦*^ (retainer)', kw:'contrato recurrente retainer mensual suscripcion abono fijo pedido automatico', run:()=>{try{openRetainerModal();}catch(e){}}},
  {tab:'finanzas', icon:'icon-dollar', title:'Arqueo de caja del dÃ­a', kw:'arqueo caja efectivo cuadre diario cierre conteo dinero', run:()=>{try{finSwitchTab('diario');setTimeout(()=>{try{renderArqueo();document.getElementById('arqueoCard')?.scrollIntoView({behavior:'smooth'});}catch(e){}},100);}catch(e){}}},
  {tab:'proveedores',icon:'icon-proveedores', title:'Nueva orden de compra', kw:'orden compra oc proveedor comprar insumos pedido materiales', run:()=>{try{openOCModal();}catch(e){}}},
  {tab:'finanzas', icon:'icon-target', title:'Punto de equilibrio', kw:'punto equilibrio break even costos fijos cuanto vender rentabilidad', run:()=>{try{finSwitchTab('presupuesto');setTimeout(()=>{try{renderBreakEven();document.getElementById('breakEvenCard')?.scrollIntoView({behavior:'smooth'});}catch(e){}},100);}catch(e){}}},
  {tab:'finanzas', icon:'icon-dollar', title:'IVA del mes (F29)', kw:'iva f29 impuesto sii debito credito fiscal pagar mensual', run:()=>{try{finSwitchTab('resumen');setTimeout(()=>{try{renderIvaMensual();document.getElementById('ivaMensualCard')?.scrollIntoView({behavior:'smooth'});}catch(e){}},100);}catch(e){}}},
];

function _gsNorm(s){return (s||'').toString().toLowerCase().normalize('NFD').replace(/[Ì€-Í¯]/g,'');}
function _gsHi(text,q){
  const t=(text||'').toString(); if(!q) return escapeHtml(t);
  const i=_gsNorm(t).indexOf(_gsNorm(q)); if(i<0) return escapeHtml(t);
  return escapeHtml(t.slice(0,i))+'<mark>'+escapeHtml(t.slice(i,i+q.length))+'</mark>'+escapeHtml(t.slice(i+q.length));
}
function _gsAllowed(tab){
  const u=AUTH.getUser(); if(!u) return true;
  const allowed=[...(RBAC.tabs[u.role]||RBAC.tabs.demo),...(RBAC.nuevos[u.role]||[])];
  return allowed.includes(tab);
}
function _gsClienteNombre(rec){
  const st=window.state||{}; const cf=rec.fields&&rec.fields['Cliente'];
  const cid=Array.isArray(cf)?cf[0]:cf;
  if(cid&&st.clientesById&&st.clientesById[cid]) return st.clientesById[cid];
  return (typeof cf==='string')?cf:'';
}
function _gsFocusRow(id){
  const row=document.querySelector('[data-id="'+id+'"]')||document.getElementById('row-'+id);
  if(row&&row.scrollIntoView){row.scrollIntoView({behavior:'smooth',block:'center'});row.classList.add('row-selected');setTimeout(()=>row.classList.remove('row-selected'),2200);}
}

function globalSearchOnInput(raw){
  const q=(raw||'').trim();
  const clr=document.getElementById('gsClear'); if(clr) clr.style.display=q?'flex':'none';
  const kbd=document.querySelector('.gs-kbd'); if(kbd) kbd.style.display=q?'none':'';
  const box=document.getElementById('globalSearchResults'); if(!box) return;
  const nq=_gsNorm(q);
  const groups=[];

  // 1. Secciones
  const secs=GS_SECTIONS.filter(s=>_gsAllowed(s.tab)).filter(s=>!q||_gsNorm(s.title).includes(nq)||_gsNorm(s.kw).includes(nq));
  if(secs.length) groups.push({cat:'Secciones',items:secs.map(s=>({icon:s.icon,bg:s.c,title:s.title,sub:'',go:'Ir â†’',run:()=>switchTab(s.tab)}))});

  // 2. Acciones rÃ¡pidas
  // Una acciÃ³n sin secciÃ³n declarada quedaba visible para todos: por ahÃ­ un rol
  // sin acceso a Finanzas llegaba al arqueo de caja, al IVA del mes o al
  // respaldo completo del CRM. Las de configuraciÃ³n se acotan por rol.
  const _u=AUTH.getUser();
  const _config=!_u||RBAC.canConfigRole(_u.role);
  const acts=GS_ACTIONS.filter(a=>(!a.nuevo||_gsAllowed(a.nuevo))&&(!a.tab||_gsAllowed(a.tab))&&(!a.config||_config)).filter(a=>!q||_gsNorm(a.title).includes(nq)||_gsNorm(a.kw).includes(nq));
  if(acts.length) groups.push({cat:'Acciones',items:acts.map(a=>({icon:a.icon,bg:'',title:a.title,sub:'',go:'',run:a.run}))});

  // 3. Datos (sÃ³lo con 2+ caracteres)
  if(q.length>=2){
    const st=window.state||{}; const byCat={};
    const push=(cat,it)=>{(byCat[cat]=byCat[cat]||[]).push(it);};
    // El permiso de la paleta era solo por secciÃ³n: un comercial tiene acceso a
    // Clientes, Pedidos y Cotizaciones, asÃ­ que la bÃºsqueda le mostraba los de
    // TODA la empresa â€”con montos y con "Ver PDF" de cualquier cotizaciÃ³nâ€”
    // aunque las listas de esas mismas secciones sÃ­ filtran por vendedor.
    const _mio=(r)=>(typeof isVendorMode!=='function'||!isVendorMode())||vendorOwnsRecord(r);
    if(_gsAllowed('clientes')) (st.clientes||[]).filter(_mio).forEach(c=>{
      const nom=c.fields['Empresa']||c.fields['Contacto']||'â€”';
      if(_gsNorm(nom).includes(nq)||_gsNorm(c.fields['Contacto']||'').includes(nq)){
        // Acciones directas sobre el cliente, sin salir del palette
        const email=c.fields['Email']||'';
        const extras=[];
        if(email&&_gsAllowed('correos')) extras.push({e:'âœ‰',t:'Escribir correo',run:()=>{switchTab('correos');setTimeout(()=>{try{MAIL.openCompose({to:email});}catch(x){}},400);}});
        extras.push({e:'ğŸ’¬',t:'Estrategia de venta IA',run:()=>{try{runSalesAgent(c.id);}catch(x){}}});
        extras.push({e:'â™»',t:'Reactivar / reconectar IA',run:()=>{try{runClienteWinbackAgent(c.id);}catch(x){}}});
        if((c.fields['Facturas vencidas']||0)>0&&_gsAllowed('finanzas')) extras.push({e:'ğŸ’°',t:'Cobrar (recordatorio IA)',run:()=>{try{runFinanceAgent(c.id);}catch(x){}}});
        push('Clientes',{icon:'icon-clientes',bg:'#3b82f6',title:nom,sub:'Cliente',go:'Abrir â†’',extras,run:()=>{switchTab('clientes');setTimeout(()=>_gsFocusRow(c.id),250);}});
      }
    });
    if(_gsAllowed('pedidos')) (st.pedidos||[]).filter(_mio).forEach(p=>{
      const num=p.fields['NÂ° Pedido']||p.id; const cli=_gsClienteNombre(p);
      if(_gsNorm(num).includes(nq)||_gsNorm(cli).includes(nq))
        push('Pedidos',{icon:'icon-pedidos',bg:'#ff6b35',title:num,sub:'Pedido'+(p.fields['Estado pedido']?' Â· '+p.fields['Estado pedido']:'')+(cli?' Â· '+cli:''),go:'Abrir â†’',run:()=>{switchTab('pedidos');setTimeout(()=>_gsFocusRow(p.id),250);}});
    });
    if(_gsAllowed('cotizaciones')) (st.cotizaciones||[]).filter(_mio).forEach(co=>{
      const num=co.fields['NÂ° CotizaciÃ³n']||co.id; const cli=_gsClienteNombre(co);
      if(_gsNorm(num).includes(nq)||_gsNorm(cli).includes(nq)){
        const extras=[];
        if((co.fields['Estado cotizaciÃ³n']||'')==='Enviada') extras.push({e:'âœ¨',t:'Seguimiento IA',run:()=>{try{runFollowupAgent(co.id);}catch(x){}}});
        extras.push({e:'ğŸ“„',t:'Ver PDF',run:()=>{try{generarPDFCotizacion(co.id);}catch(x){}}});
        push('Cotizaciones',{icon:'icon-cotizaciones',bg:'#a78bfa',title:num,sub:'CotizaciÃ³n'+(cli?' Â· '+cli:'')+(co.fields['Estado cotizaciÃ³n']?' Â· '+co.fields['Estado cotizaciÃ³n']:''),go:'Abrir â†’',extras,run:()=>{switchTab('cotizaciones');setTimeout(()=>_gsFocusRow(co.id),250);}});
      }
    });
    if(_gsAllowed('proveedores')) (st.proveedores||[]).forEach(pv=>{
      const nom=pv.fields['Nombre']||'â€”';
      if(_gsNorm(nom).includes(nq))
        push('Proveedores',{icon:'icon-proveedores',bg:'#ffaa00',title:nom,sub:'Proveedor',go:'Abrir â†’',run:()=>switchTab('proveedores')});
    });
    if(_gsAllowed('finanzas')){
      try{
        const fv=JSON.parse(localStorage.getItem('fin_ventas')||'[]');
        fv.filter(v=>_gsNorm((v.nro||'')+(v.cliente||'')+(v.concepto||'')).includes(nq)).slice(0,4).forEach(v=>{
          push('Facturas',{icon:'icon-finanzas',bg:'#22c55e',title:v.nro||'Sin NÂ°',sub:(v.cliente||'â€”')+' Â· '+formatCLP(v.monto||0),go:'Abrir â†’',run:()=>{switchTab('finanzas');setTimeout(()=>finSwitchTab('facturas'),300);}});
        });
      }catch(e){}
    }
    ['Clientes','Pedidos','Cotizaciones','Proveedores','Facturas'].forEach(cat=>{
      if(byCat[cat]&&byCat[cat].length) groups.push({cat:cat,items:byCat[cat].slice(0,6)});
    });
  }

  _gsResults=[]; _gsExtras=[]; _gsActive=-1;
  if(!groups.length){
    box.innerHTML='<div class="gs-empty">Sin resultados para â€œ'+escapeHtml(q)+'â€</div>';
    box.classList.add('open'); return;
  }
  let html='';
  groups.forEach(g=>{
    html+='<div class="gs-cat">'+escapeHtml(g.cat)+'</div>';
    g.items.forEach(it=>{
      const idx=_gsResults.length; _gsResults.push(it.run);
      const emojiStyle=it.bg?('background:'+it.bg):'';
      const iconSvg=it.icon?'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="'+(it.bg?'#fff':'var(--accent)')+'" stroke-width="1.5" style="overflow:visible;flex-shrink:0"><use href="#'+it.icon+'"/></svg>':'';
      // Chips de acciÃ³n directa (correo, IA, cobrar, PDFâ€¦) sobre la misma fila
      let chips='';
      (it.extras||[]).forEach(x=>{
        const xi=_gsExtras.length; _gsExtras.push(x.run);
        chips+='<span title="'+escapeHtml(x.t)+'" onmousedown="event.preventDefault();event.stopPropagation();_gsRunExtra('+xi+')" style="flex-shrink:0;font-size:12px;padding:3px 8px;border-radius:6px;background:var(--surface2);border:1px solid var(--border2);cursor:pointer;margin-left:4px">'+x.e+'</span>';
      });
      html+='<div class="gs-item" data-gsi="'+idx+'" onmousedown="event.preventDefault();_gsRun('+idx+')" onmouseenter="_gsSetActive('+idx+')">'
        +'<span class="gs-emoji" style="'+emojiStyle+'">'+iconSvg+'</span>'
        +'<span class="gs-txt"><span class="gs-title">'+_gsHi(it.title,q)+'</span>'+(it.sub?'<span class="gs-sub">'+escapeHtml(it.sub)+'</span>':'')+'</span>'
        +chips
        +(it.go?'<span class="gs-go">'+escapeHtml(it.go)+'</span>':'')
      +'</div>';
    });
  });
  box.innerHTML=html;
  box.classList.add('open');
}
function _gsRun(idx){
  const fn=_gsResults[idx];
  if(typeof fn==='function'){ globalSearchClear(true); fn(); }
}
function _gsRunExtra(idx){
  const fn=_gsExtras[idx];
  if(typeof fn==='function'){ globalSearchClear(true); fn(); }
}
function _gsSetActive(idx){
  _gsActive=idx;
  document.querySelectorAll('#globalSearchResults .gs-item').forEach(el=>{
    el.classList.toggle('gs-active', parseInt(el.dataset.gsi)===idx);
  });
}
function _gsScrollActive(){
  const el=document.querySelector('#globalSearchResults .gs-item.gs-active');
  if(el&&el.scrollIntoView) el.scrollIntoView({block:'nearest'});
}
function globalSearchOnKey(e){
  const box=document.getElementById('globalSearchResults');
  if(e.key==='Escape'){ globalSearchClear(true); e.target.blur(); return; }
  if(!box||!box.classList.contains('open')){ if(e.key==='ArrowDown') globalSearchOnInput(e.target.value); return; }
  const n=_gsResults.length;
  if(e.key==='ArrowDown'){ e.preventDefault(); if(n){_gsSetActive((_gsActive+1)%n);_gsScrollActive();} }
  else if(e.key==='ArrowUp'){ e.preventDefault(); if(n){_gsSetActive((_gsActive-1+n)%n);_gsScrollActive();} }
  else if(e.key==='Enter'){ e.preventDefault(); if(_gsActive>=0)_gsRun(_gsActive); else if(n)_gsRun(0); }
}
function globalSearchClear(keepBlur){
  const inp=document.getElementById('globalSearchInput');
  if(inp) inp.value='';
  const clr=document.getElementById('gsClear'); if(clr) clr.style.display='none';
  const kbd=document.querySelector('.gs-kbd'); if(kbd) kbd.style.display='';
  closeGlobalSearch();
  if(!keepBlur&&inp) inp.focus();
}
function closeGlobalSearch(){
  const box=document.getElementById('globalSearchResults');
  if(box){box.classList.remove('open');box.innerHTML='';}
  _gsResults=[]; _gsActive=-1;
}
function initGlobalSearch(){
  if(_gsInited) return; _gsInited=true;
  document.addEventListener('click',e=>{
    const gs=document.getElementById('globalSearch');
    if(gs&&!gs.contains(e.target)) closeGlobalSearch();
  });
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&(e.key==='k'||e.key==='K')){
      e.preventDefault();
      const inp=document.getElementById('globalSearchInput');
      if(inp){inp.focus();inp.select();globalSearchOnInput(inp.value);}
    }
  });
}

// â”€â”€ SII / DTE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getSIICfg(){try{const c=JSON.parse(localStorage.getItem('sii_cfg')||'{}');return{webhookUrl:c.webhookUrl||_DEFAULTS.SII_WORKER_URL,rutEmisor:c.rutEmisor||_DEFAULTS.SII_RUT_EMISOR,razonEmisor:c.razonEmisor||_DEFAULTS.SII_RAZON_SOCIAL};}catch(e){return{webhookUrl:_DEFAULTS.SII_WORKER_URL,rutEmisor:_DEFAULTS.SII_RUT_EMISOR,razonEmisor:_DEFAULTS.SII_RAZON_SOCIAL};}}
async function uploadCAF(tipo,input){
  const file=input.files[0];if(!file)return;
  const cfg=getSIICfg();
  if(!cfg?.webhookUrl){toast('Configura primero la URL del Worker SII','error');input.value='';return;}
  const statusEl=document.getElementById('cafStatus'+tipo);
  if(statusEl){statusEl.style.color='var(--text3)';statusEl.textContent='â³ Subiendo...';}
  try{
    const caf_xml=await file.text();
    const r=await fetch(cfg.webhookUrl+'/caf',{method:'PUT',headers:siiHeaders({'Content-Type':'application/json'}),body:JSON.stringify({tipo_documento:tipo,caf_xml})});
    const d=await r.json();
    if(r.ok){
      if(statusEl){statusEl.style.color='var(--accent)';statusEl.textContent='âœ… Folios '+d.rango?.desde+'â€“'+d.rango?.hasta;}
      toast('âœ… CAF tipo '+tipo+' subido â€” folios '+d.rango?.desde+'â€“'+d.rango?.hasta,'success');
    }else{
      if(statusEl){statusEl.style.color='var(--danger)';statusEl.textContent='â›” '+(d.error||r.status);}
      toast('Error subiendo CAF: '+(d.error||r.status),'error');
    }
  }catch(e){
    if(statusEl){statusEl.style.color='var(--danger)';statusEl.textContent='â›” '+e.message;}
    toast('Error: '+e.message,'error');
  }
  input.value='';
}
async function checkFolios(tipo){
  const cfg=getSIICfg();
  if(!cfg?.webhookUrl){toast('Configura primero la URL del Worker SII','error');return;}
  const statusEl=document.getElementById('cafStatus'+tipo);
  if(statusEl){statusEl.style.color='var(--text3)';statusEl.textContent='â³...';}
  try{
    const r=await fetch(cfg.webhookUrl+'/folio/'+tipo,{headers:siiHeaders()});
    const d=await r.json();
    if(r.ok){
      const disp=d.folios_disponibles;
      const color=disp<=10?'var(--danger)':disp<=30?'var(--warning)':'var(--accent)';
      if(statusEl){statusEl.style.color=color;statusEl.textContent=(disp<=10?'âš  ':'âœ… ')+'Sgte: '+d.siguiente_folio+' Â· Disp: '+disp;}
    }else{
      if(statusEl){statusEl.style.color='var(--text3)';statusEl.textContent='Sin CAF cargado';}
    }
  }catch(e){
    if(statusEl){statusEl.style.color='var(--danger)';statusEl.textContent='â›” '+e.message;}
  }
}
function openDTEModal(pedidoId){
  const p=state.pedidosById[pedidoId];if(!p) return;
  const f=p.fields;
  const clienteId=Array.isArray(f['Cliente'])?f['Cliente'][0]:f['Cliente'];
  const c=state.clientes.find(x=>x.id===clienteId);
  const cf=c?.fields||{};
  document.getElementById('dtePedidoId').value=pedidoId;
  document.getElementById('dteRefPedido').value=f['NÂ° Pedido']||'';
  document.getElementById('dteRut').value=cf['RUT']||'';
  document.getElementById('dteRazonSocial').value=cf['Empresa']||'';
  document.getElementById('dteGiro').value=cf['Industria / Rubro']||'';
  document.getElementById('dteEmail').value=cf['Email']||'';
  document.getElementById('dteDescripcion').value=f['Solicitud cliente (texto libre)']||f['Detalle productos']||'Servicio de fabricaciÃ³n digital';
  const neto=Math.round((f['Monto total (CLP)']||0)/1.19);
  document.getElementById('dteMontoNeto').value=neto||'';
  dteRecalcular();
  document.getElementById('dteObservaciones').value=('Pedido '+(f['NÂ° Pedido']||'')).trim();
  document.getElementById('dteRutMsg').textContent='';
  const btn=document.getElementById('dteSubmitBtn');if(btn){btn.disabled=false;btn.textContent='ğŸ“¤ Emitir DTE';}
  const dteNum=f['DTE NÂ°']||'';
  if(dteNum&&btn){btn.textContent='ğŸ“¤ Emitir nuevo DTE';btn.style.opacity='0.85';}else if(btn){btn.style.opacity='1';}
  const cfg=getSIICfg();
  const sb=document.getElementById('dteSIIStatus');
  if(cfg?.webhookUrl){sb.style.color='var(--accent)';sb.innerHTML='\u2705 Webhook configurado \u2014 emisor: <strong>'+escapeHtml(cfg.razonEmisor||cfg.rutEmisor||'Tu empresa')+'</strong>'+(dteNum?' &nbsp;&middot;&nbsp; <span style="color:var(--accent3)">DTE anterior: N\u00b0 '+escapeHtml(dteNum)+'</span>':'');}
  else{sb.style.color='var(--text3)';sb.innerHTML='âš  Sin configurar â€” <a href="#" onclick="openSIIConfigModal();event.preventDefault()" style="color:var(--accent)">configura el Worker SII</a>';}
  document.getElementById('dteModal').style.display='flex';
}
function closeDTEModal(){document.getElementById('dteModal').style.display='none';}
function dteRecalcular(){
  const neto=parseInt(document.getElementById('dteMontoNeto').value)||0;
  const iva=Math.round(neto*0.19);
  document.getElementById('dteIva').value=neto?formatCLP(iva):'';
  document.getElementById('dteTotal').value=neto?formatCLP(neto+iva):'';
}
function dteValidarRut(el){
  const msg=document.getElementById('dteRutMsg');const v=(el.value||'').trim();
  if(!v){msg.textContent='';return;}
  if(validRUT(v)){msg.style.color='var(--accent)';msg.textContent='âœ“ RUT vÃ¡lido';el.value=formatRUT(v);}
  else{msg.style.color='var(--danger)';msg.textContent='âœ— RUT invÃ¡lido â€” revisa el dÃ­gito verificador';}
}
async function emitirDTE(){
  const cfg=getSIICfg();
  if(!cfg?.webhookUrl){toast('Configura el Worker SII primero','error');openSIIConfigModal();return;}
  const pedidoId=document.getElementById('dtePedidoId').value;
  const rut=(document.getElementById('dteRut').value||'').trim();
  const razonSocial=(document.getElementById('dteRazonSocial').value||'').trim();
  const neto=parseInt(document.getElementById('dteMontoNeto').value)||0;
  if(!rut||!validRUT(rut)){toast('RUT receptor invÃ¡lido â€” revisa el dÃ­gito verificador','error');return;}
  if(!razonSocial){toast('La razÃ³n social es requerida','error');return;}
  if(!neto){toast('El monto neto debe ser mayor a 0','error');return;}
  const btn=document.getElementById('dteSubmitBtn');btn.disabled=true;btn.textContent='â³ Emitiendo...';
  const iva=Math.round(neto*0.19);
  const payload={
    tipo_documento:document.getElementById('dteTipoDoc').value,
    referencia:document.getElementById('dteRefPedido').value,
    emisor:{rut:cfg.rutEmisor||'',razon_social:cfg.razonEmisor||''},
    receptor:{rut:formatRUT(rut),razon_social:razonSocial,giro:document.getElementById('dteGiro').value,email:document.getElementById('dteEmail').value},
    detalle:[{nombre:document.getElementById('dteDescripcion').value||'Servicio de fabricaciÃ³n digital',cantidad:1,precio_unitario:neto,monto_neto:neto}],
    totales:{neto,iva,total:neto+iva},
    observaciones:document.getElementById('dteObservaciones').value
  };
  try{
    const r=await fetch(cfg.webhookUrl,{method:'POST',headers:siiHeaders({'Content-Type':'application/json'}),body:JSON.stringify(payload)});
    if(!r.ok) throw new Error(`HTTP ${r.status} â€” verifica la URL del webhook`);
    let resp={};try{resp=await r.json();}catch(e){}
    const dteNum=resp.dte_numero||resp.folio||resp.numero||resp.id||'';
    const tipoDTE=document.getElementById('dteTipoDoc').value;
    // Sin TrackID no hay constancia de que el SII haya recibido el envÃ­o. Antes
    // esto se celebraba igual â€”"âœ… DTE emitido"â€”, se anotaba en el pedido y se
    // creaba la Factura con Estado SII "Enviado": un documento tributario dado
    // por bueno sin que nadie del SII lo hubiera acusado.
    const _trackId=resp.trackid||resp.track_id||'';
    const _recibido=(resp.recibido!==false)&&!!_trackId;
    const pdfUrl=resp.pdf_url||resp.url_pdf||resp.pdf||(dteNum?cfg.webhookUrl+'/pdf/'+tipoDTE+'/'+dteNum:'');
    if(dteNum){
      // El folio ya se consumiÃ³ en el SII: si aquÃ­ falla el guardado, el nÃºmero
      // queda solo en memoria y al recargar el pedido aparece sin DTE. Hay que
      // avisar sÃ­ o sÃ­ â€” el documento tributario existe aunque el dashboard lo pierda.
      try{await airtableWrite('Pedidos','PATCH',pedidoId,{'DTE NÂ°':String(dteNum)});}
      catch(e){avisoNoGuardado(`el DTE NÂ° ${dteNum} en el pedido (ya fue emitido en el SII â€” anÃ³talo)`,e);}
      const p=state.pedidosById[pedidoId];if(p) p.fields['DTE NÂ°']=String(dteNum);
      // Materializa el DTE como Factura ligada al pedido (para cobranza y reportes)
      try{
        if(typeof ensureFacturasTable==='function') await ensureFacturasTable();
        const cid=p?(Array.isArray(p.fields['Cliente'])?p.fields['Cliente'][0]:p.fields['Cliente']):'';
        const venc=new Date(Date.now()+30*864e5).toISOString().slice(0,10);
        await airtableWrite('Facturas','POST',null,{
          'Cliente':razonSocial,'Cliente ID':cid||'','Tipo DTE':tipoDTE,'Folio':Number(dteNum)||0,
          'Fecha':hoyCL(),'Neto':neto,'IVA':iva,'Total':neto+iva,
          'Track ID':_trackId,'Estado SII':_recibido?(resp.estado_sii||resp.estado||'Enviado'):'Sin confirmar',
          'Estado Pago':'Pendiente','Fecha Vencimiento':venc,'NÂ° Pedido':p?.fields['NÂ° Pedido']||''
        });
        try{await loadAllDataSilent();}catch(e){}
      }catch(e){console.warn('[DTE] no se pudo crear la Factura ligada:',e.message);}
      renderPedidos();
    }
    if(_recibido){
      toast('\u2705 DTE emitido'+(dteNum?' \u2014 N\u00b0 '+dteNum:'')+(pdfUrl?' \u00b7 <a href="'+escapeHtml(pdfUrl)+'" target="_blank" style="color:var(--accent)">Ver PDF</a>':''),'success');
      if(pdfUrl) window.open(pdfUrl,'_blank');
      closeDTEModal();
    }else{
      // El folio queda consumido igual (reemitirlo arriesga dos documentos con
      // el mismo nÃºmero), asÃ­ que hay que decir exactamente quÃ© revisar.
      toast(escapeHtml(resp.aviso||('El SII no acus\u00f3 recibo del env\u00edo'+(dteNum?' (folio '+dteNum+')':'')+'. El folio queda consumido: rev\u00edsalo en el portal del SII antes de reemitir.')),'error');
      const _sb=document.getElementById('dteSIIStatus');
      if(_sb){_sb.style.color='var(--danger)';_sb.textContent='\u26a0 Sin confirmaci\u00f3n del SII'+(dteNum?' \u2014 folio '+dteNum:'')+'. No reemitas sin revisar el portal.';}
    }
  }catch(e){toast('Error al emitir DTE: '+e.message,'error');}
  btn.disabled=false;btn.textContent='ğŸ“¤ Emitir DTE';
}
function openSIIConfigModal(){
  const cfg=getSIICfg();
  document.getElementById('siiWebhookUrl').value=cfg.webhookUrl||'';
  document.getElementById('siiRutEmisor').value=cfg.rutEmisor||'';
  document.getElementById('siiRazonEmisor').value=cfg.razonEmisor||'';
  const sb=document.getElementById('siiStatusBox');
  if(cfg?.webhookUrl){sb.style.color='var(--accent)';sb.innerHTML='âœ… Worker activo: <strong>'+escapeHtml(cfg.webhookUrl)+'</strong>';}
  else{sb.style.color='var(--text3)';sb.textContent='Sin configurar â€” ingresa la URL del Worker SII.';}
  // Reset CAF status
  ['33','39','61'].forEach(t=>{const el=document.getElementById('cafStatus'+t);if(el){el.style.color='var(--text3)';el.textContent='â€”';}});
  document.getElementById('siiConfigModal').style.display='flex';
  // Auto-check folios if URL is configured
  if(cfg?.webhookUrl) setTimeout(()=>['33','39','61'].forEach(checkFolios),300);
}
function closeSIIConfigModal(){document.getElementById('siiConfigModal').style.display='none';}
function saveSIIConfig(){
  const webhookUrl=(document.getElementById('siiWebhookUrl').value||'').trim();
  const rutEmisor=(document.getElementById('siiRutEmisor').value||'').trim();
  const razonEmisor=(document.getElementById('siiRazonEmisor').value||'').trim();
  if(!webhookUrl){toast('La URL del Worker es requerida','error');return;}
  localStorage.setItem('sii_cfg',JSON.stringify({webhookUrl,rutEmisor,razonEmisor}));
  toast('âœ“ ConfiguraciÃ³n SII guardada','success');
  const sb=document.getElementById('dteSIIStatus');
  if(sb&&document.getElementById('dteModal').style.display!=='none'){
    sb.style.color='var(--accent)';sb.innerHTML='âœ… Worker SII activo â€” emisor: <strong>'+escapeHtml(razonEmisor||rutEmisor||'Tu empresa')+'</strong>';
  }
  closeSIIConfigModal();
}
async function testSIIWorker(){
  const url=(document.getElementById('siiWebhookUrl').value||'').trim();
  if(!url){toast('Ingresa la URL del Worker primero','error');return;}
  const sb=document.getElementById('siiStatusBox');
  if(sb){sb.style.color='var(--text3)';sb.textContent='â³ Probando conexiÃ³n...';}
  try{
    const r=await fetch(url+'/health',{method:'GET'});
    const d=await r.json();
    if(r.ok){
      if(sb){sb.style.color='var(--accent)';sb.innerHTML='âœ… Worker activo â€” env: <strong>'+escapeHtml(d.sii_env||'?')+'</strong> | RUT: '+escapeHtml(d.rut_emisor||'?')+'<br>'+(d.cert_loaded?'ğŸ” Certificado cargado':'âš  Certificado no cargado');}
      toast('âœ… Worker SII conectado','success');
    }else{
      if(sb){sb.style.color='var(--danger)';sb.textContent='â›” Error '+r.status+': '+JSON.stringify(d);}
      toast('Error: '+r.status,'error');
    }
  }catch(e){
    if(sb){sb.style.color='var(--danger)';sb.textContent='â›” No se pudo conectar: '+e.message;}
    toast('Error de conexiÃ³n: '+e.message,'error');
  }
}

// â”€â”€ FUNNEL DE CONVERSIÃ“N â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderFunnel(){
  const el=document.getElementById('ovFunnelBody');if(!el)return;
  const now=new Date();
  const ms=new Date(now.getFullYear(),now.getMonth(),1);
  const me=new Date(now.getFullYear(),now.getMonth()+1,0);
  const periodoLabel=ms.toLocaleDateString('es-CL',{month:'long',year:'numeric'});
  const lbl=document.getElementById('ovFunnelPeriodo');if(lbl)lbl.textContent=periodoLabel;
  const _cot=isVendorMode()?state.cotizaciones.filter(vendorOwnsRecord):state.cotizaciones;
  const _ped=isVendorMode()?state.pedidos.filter(vendorOwnsRecord):state.pedidos;
  const _cli=isVendorMode()?state.clientes.filter(vendorOwnsRecord):state.clientes;
  const inMes=d=>d&&new Date(d)>=ms&&new Date(d)<=me;
  // Stages
  const leads=_cli.filter(c=>c.createdTime&&inMes(c.createdTime)).length;
  const cots=_cot.filter(c=>c.createdTime&&inMes(c.createdTime)).length;
  const peds=_ped.filter(p=>p.createdTime&&inMes(p.createdTime)&&(p.fields['Estado pedido']||'')!=='Cancelado').length;
  const cerrados=_ped.filter(p=>['Despachado','Completado'].includes(p.fields['Estado pedido']||'')&&p.createdTime&&inMes(p.createdTime)).length;
  const valCots=_cot.filter(c=>c.createdTime&&inMes(c.createdTime)).reduce((s,c)=>s+Math.round((c.fields['Total final (CLP)']||0)/1.19),0);
  const valPeds=_ped.filter(p=>p.createdTime&&inMes(p.createdTime)&&(p.fields['Estado pedido']||'')!=='Cancelado').reduce((s,p)=>s+Math.round((p.fields['Monto total (CLP)']||0)/1.19),0);
  const valCerr=_ped.filter(p=>['Despachado','Completado'].includes(p.fields['Estado pedido']||'')&&p.createdTime&&inMes(p.createdTime)).reduce((s,p)=>s+Math.round((p.fields['Monto total (CLP)']||0)/1.19),0);
  const pct=(a,b)=>b>0?Math.round(a/b*100):0;
  const stages=[
    {icon:'<svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#icon-clientes"/></svg>',label:'Leads Nuevos',n:leads,val:null,color:'var(--accent4)',next:cots},
    {icon:'<svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#icon-cotizaciones"/></svg>',label:'Cotizaciones',n:cots,val:valCots,color:'var(--accent)',next:peds},
    {icon:'ğŸ“¦',label:'Pedidos',n:peds,val:valPeds,color:'var(--accent2)',next:cerrados},
    {icon:'âœ…',label:'Cerrados',n:cerrados,val:valCerr,color:'var(--accent3)',next:null},
  ];
  const cols=stages.map((s,i)=>{
    const conv=i>0&&stages[i-1].n>0?`<div style="font-size:10px;color:var(--text3);margin-top:4px">${pct(s.n,stages[i-1].n)}% conv.</div>`:'';
    const arrow=i<stages.length-1?`<div style="font-size:20px;color:var(--text3);align-self:center">â†’</div>`:'';
    return`<div style="text-align:center;flex:1;min-width:90px">
      <div style="font-size:22px;margin-bottom:2px">${s.icon}</div>
      <div style="font-size:28px;font-weight:700;color:${s.color};font-family:'Bebas Neue',sans-serif">${s.n}</div>
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px">${s.label}</div>
      ${s.val!=null?`<div style="font-size:11px;color:var(--text2);font-weight:600">${formatCLP(s.val)}</div>`:''}
      ${conv}
    </div>${arrow}`;
  }).join('');
  // Bar visual
  const max=Math.max(leads,cots,peds,cerrados,1);
  const bars=stages.map(s=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
    <div style="width:80px;font-size:10px;color:var(--text3);text-align:right;flex-shrink:0">${s.label}</div>
    <div style="flex:1;height:18px;background:var(--surface2);border-radius:4px;overflow:hidden">
      <div style="height:100%;width:${pct(s.n,max)}%;background:${s.color};border-radius:4px;transition:width .4s;min-width:${s.n>0?'24px':'0'}"></div>
    </div>
    <div style="width:28px;font-size:11px;font-weight:700;color:${s.color};text-align:right;flex-shrink:0">${s.n}</div>
  </div>`).join('');
  el.innerHTML=`<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:16px;padding:0 4px">${cols}</div><div style="border-top:1px solid var(--border);padding-top:14px">${bars}</div>`;
}

// â”€â”€ REMUNERACIONES SUELDOS & LIQUIDACIÃ“N â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const REM_SUELDO_KEY='rem_sueldos_v1';
function remToggleSueldos(){
  const p=document.getElementById('remSueldoPanel');if(!p) return;
  const vis=p.style.display==='none';p.style.display=vis?'':'none';
  if(vis) remRenderSueldoGrid();
}
function remRenderSueldoGrid(){
  const grid=document.getElementById('remSueldoGrid');if(!grid) return;
  let sueldos;try{sueldos=JSON.parse(localStorage.getItem(REM_SUELDO_KEY)||'{}');}catch(e){sueldos={};}
  const personas=typeof PERSONAS!=='undefined'?PERSONAS:[];
  if(!personas.length){grid.innerHTML='<div style="font-size:11px;color:var(--text3)">No hay integrantes configurados</div>';return;}
  grid.innerHTML=personas.map(p=>`<div class="field-group" style="margin:0">
    <label class="field-label" style="display:flex;align-items:center;gap:4px"><span>${p.avatar}</span> ${escapeHtml(p.nombre)}</label>
    <input class="field-input" id="rem-sueldo-${p.nombre.replace(/\s/g,'_')}" type="number" min="0" step="10000" placeholder="0" value="${sueldos[p.nombre]||''}">
  </div>`).join('');
}
function remSaveSueldos(){
  const personas=typeof PERSONAS!=='undefined'?PERSONAS:[];
  const sueldos={};
  personas.forEach(p=>{const id='rem-sueldo-'+p.nombre.replace(/\s/g,'_');const v=parseInt(document.getElementById(id)?.value)||0;if(v>0) sueldos[p.nombre]=v;});
  localStorage.setItem(REM_SUELDO_KEY,JSON.stringify(sueldos));
  toast('âœ“ Sueldos guardados','success');
  rendem«ëŒ+Š×®º+º$zzb¥ç%&V×VæW&6–öæW2‚“°§Ğ¦gVæ7F–öâ&VÕ&VæFW$Æ—V–F6–öâ‡F÷FÄæWFòÇF÷FÄ6öÖ—6–öâ—°¢6öç7BÆ—&öG“ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w&VÔÆ—&öG’r“¶–b‚Æ—&öG’’&WGW&ã°¢ÆWB7VVÆF÷3·G'—·7VVÆF÷3Ô¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ…$TÕõ5TTÄDõô´U’—ÇÂw·Òr“·Ö6F6‚†R—·7VVÆF÷3×·Ó·Ğ¢6öç7BW'6öæ3×G—VöbU%4ôä2ÓÒwVæFVf–æVBsõU%4ôä3¥µÓ°¢6öç7B—FV×3×W'6öæ2æÖ‡Óç°¢6öç7B7VVÆFó×7VVÆF÷5·ææöÖ'&U×ÇÃ°¢6öç7BgÔÖF‚ç&÷VæB‡7VVÆFò£ã“°¢6öç7B—6&SÔÖF‚ç&÷VæB‡7VVÆFò£ãr“°¢6öç7B6öÖ—6–öãÔÖF‚ç&÷VæB‡7VVÆFóã÷F÷FÄ6öÖ—6–öâ÷W'6öæ2æÆVæwFƒ£“°¢6öç7BæWFó×7VVÆFòÖgÖ—6&R¶6öÖ—6–öã°¢&WGW&ç¶æöÖ'&S§ææöÖ'&RÆfF#§æfF"Ç7VVÆFòÆgÆ—6&RÆ6öÖ—6–öâÆæWF÷Ó°¢Ò’æf–ÇFW"‡ƒÓç‚ç7VVÆFóãÇÇ‚æ6öÖ—6–öãã“°¢–b‚—FV×2æÆVæwF‚—¶Æ—&öG’æ–ææW$…DÔÃÒsÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#ä6öæf–wW&Æ÷27VVÆF÷2&6R&fW"ÆÆ—V–F6œ;6ãÂöF—câs·&WGW&ã·Ğ¢Æ—&öG’æ–ææW$…DÔÃÖ—FV×2æÖ‡ƒÓæÆF—b7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW"×&F—W3£‡ƒ·FF–æs£‚Gƒ¶föçB×6—¦S£ƒ¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"’#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£gƒ¶Ö&v–âÖ&÷GFöÓ£gƒ¶föçB×vV–v‡C£s#âG·‚æfF'ÒG¶W66T‡FÖÂ‡‚ææöÖ'&R—ÓÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVB†WFòÖf–ÆÂÆÖ–æÖ‚ƒ3‚Ãg"’“¶v£G‚#à¢ÆF—cãÇ7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2’#å7VVÆFò''WFó£Â÷7ãâÇ7â7G–ÆSÒ&föçB×vV–v‡C£c#âG¶f÷&ÖD4Å‡‚ç7VVÆFò—ÓÂ÷7ããÂöF—cà¢ÆF—cãÇ7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2’#äeƒR“£Â÷7ãâÇ7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖFævW"’#âÒG¶f÷&ÖD4Å‡‚æg—ÓÂ÷7ããÂöF—cà¢ÆF—cãÇ7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2’#ä—6&RƒrR“£Â÷7ãâÇ7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖFævW"’#âÒG¶f÷&ÖD4Å‡‚æ—6&R—ÓÂ÷7ããÂöF—cà¢ÆF—cãÇ7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2’#ä6öÖ—6œ;6ã£Â÷7ãâÇ7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ66VçC2’#â²G¶f÷&ÖD4Å‡‚æ6öÖ—6–öâ—ÓÂ÷7ããÂöF—cà¢ÆF—b7G–ÆSÒ&w&–BÖ6öÇVÖã£òÓ¶&÷&FW"×F÷£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FF–ær×F÷£Gƒ¶Ö&v–â×F÷£'‚#ãÇ7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2’#å7VVÆFòæWFó£Â÷7ãâÇ7â7G–ÆSÒ&föçB×vV–v‡C£s¶6öÆ÷#§f"‚ÒÖ66VçB“¶föçB×6—¦S£7‚#âG¶f÷&ÖD4Å‡‚ææWFò—ÓÂ÷7ããÂöF—cà¢ÂöF—cà¢ÂöF—cæ’æ¦ö–â‚rr“°§Ğ ¢òò)H)H$U5UTU5DòÔTå5TÂ)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¦6öç7B$U5ô´U“Òvf–å÷&W7WVW7Fõ÷cs°¦6öç7B$U5ô4E5ôDTdTÅCÕ°¢¶–C¢vÖ&¶WF–ærrÆÆ&VÃ¢tÖ&¶WF–ærbG2rÆ6öÆ÷#¢r6cS–S"rÆ–6öã¢sÇ7fr6Æ73Ò&F6†&ö&BÖ–6öâ"v–GFƒÒ#B"†V–v‡CÒ#B"7G&ö¶R×v–GFƒÒ#ãR#ãÇW6R‡&VcÒ"6–6öâÖÖVv†öæR"óãÂ÷7fsâwÒÀ¢¶–C¢w&÷fVVF÷&W2rÆÆ&VÃ¢u&÷fVVF÷&W2òÖFW&–ÆW2rÆ6öÆ÷#¢r36#ƒ&cbrÆ–6öã¢sÇ7fr6Æ73Ò&F6†&ö&BÖ–6öâ"v–GFƒÒ#B"†V–v‡CÒ#B"7G&ö¶R×v–GFƒÒ#ãR#ãÇW6R‡&VcÒ"6–6öâ×&÷fVVF÷&W2"óãÂ÷7fsâwÒÀ¢¶–C¢w7VVÆF÷2rÆÆ&VÃ¢u7VVÆF÷2b†öæ÷&&–÷2rÆ6öÆ÷#¢r3#“ƒrÆ–6öã¢sÇ7fr6Æ73Ò&F6†&ö&BÖ–6öâ"v–GFƒÒ#B"†V–v‡CÒ#B"7G&ö¶R×v–GFƒÒ#ãR#ãÇW6R‡&VcÒ"6–6öâÖFöÆÆ""óãÂ÷7fsâwÒÀ¢¶–C¢v'&–VæFòrÆÆ&VÃ¢t'&–VæFòb6W'f–6–÷2rÆ6öÆ÷#¢r3†#V6cbrÆ–6öã¢sÇ7fr6Æ73Ò&F6†&ö&BÖ–6öâ"v–GFƒÒ#B"†V–v‡CÒ#B"7G&ö¶R×v–GFƒÒ#ãR#ãÇW6R‡&VcÒ"6–6öâÖ'V–ÆF–æs""óãÂ÷7fsâwÒÀ¢¶–C¢vWV—÷2rÆÆ&VÃ¢tWV—÷2b†W'&Ö–VçF2rÆ6öÆ÷#¢r6VcCCCBrÆ–6öã¢sÇ7fr6Æ73Ò&F6†&ö&BÖ–6öâ"v–GFƒÒ#B"†V–v‡CÒ#B"7G&ö¶R×v–GFƒÒ#ãR#ãÇW6R‡&VcÒ"6–6öâ×w&Væ6‚"óãÂ÷7fsâwÒÀ¢¶–C¢v÷G&÷2rÆÆ&VÃ¢t÷G&÷2v7F÷2rÆ6öÆ÷#¢r3f#s#ƒrÆ–6öã¢sÇ7fr6Æ73Ò&F6†&ö&BÖ–6öâ"v–GFƒÒ#B"†V–v‡CÒ#B"7G&ö¶R×v–GFƒÒ#ãR#ãÇW6R‡&VcÒ"6–6öâ×VF–F÷2"óãÂ÷7fsâwÒÀ¥Ó°¦gVæ7F–öâ&W4vWDFF‚—·G'—·&WGW&â¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ…$U5ô´U’—ÇÂw·Òr“·Ö6F6‚†R—·&WGW&ç·Ó·×Ğ¦gVæ7F–öâ&W56WDFF†B—¶Æö6Å7F÷&vRç6WD—FVÒ…$U5ô´U’Ä¥4ôâç7G&–æv–g’†B’“·Ğ¦gVæ7F–öâ&W4¶W’†æ–òÆÖW2—·&WGW&æG¶æ–÷ÒÒGµ7G&–ær†ÖW2’çE7F'Bƒ"Âsr—Ö·Ğ¢òòóc¢ÖVÆ2B6FVv÷,:Ö2FVÂÆ–'&òF–&–òÆ2bFVÂ&W7WVW7Fò&¢òò6Æ7VÆ"VÂ&V¦V7WFFò&VÂ"WFöÜ:F–6ÖVçFR†çFW26RFV6ÆV&Öæò’à¦6öç7BôÄEôõ$U3×°¢tÖFW&–ÆW2R–ç7VÖ÷2s¢w&÷fVVF÷&W2rÂtf–ÆÖVçF÷2ò&W6–æ2s¢w&÷fVVF÷&W2rÀ¢tÖV–æ&–’WV—÷2s¢vWV—÷2rÂu6ögGv&R’FV6æöÆö|:Ös¢vWV—÷2rÂtÖçFVæ6œ;6âs¢vWV—÷2rÀ¢t'&–VæFòÆö6Âs¢v'&–VæFòrÂu6W'f–6–÷2,:6–6÷2s¢v'&–VæFòrÂt–çFW&æWB’FVÆV6ö×Væ–66–öæW2s¢v'&–VæFòrÀ¢tÖ&¶WF–ær’V&Æ–6–FBs¢vÖ&¶WF–ærrÂu7VVÆF÷2’†öæ÷&&–÷2s¢w7VVÆF÷2rÀ¢t7V÷F,:—7FÖòs¢v÷G&÷2rÂuG&ç7÷'FR’Æö|:×7F–6s¢v÷G&÷2rÂt6öçF&–Æ–FB’ÆVvÂs¢v÷G&÷2rÂt÷G&÷2v7F÷2s¢v÷G&÷2p§Ó°¢òòv7Fò&VÂ÷"6FVv÷,:ÖFR&W7WVW7FòÂFöÖFòFVÂÆ–'&òF–&–òFVÂW,:ÖöFòà¦gVæ7F–öâ÷&W4V¦V7WFFõ&VÂ†æ–òÆÖW2—°¢6öç7B&Vc×&W4¶W’†æ–òÆÖW2“¶6öç7B÷WC×·Ó°¢‡G—VöbÆDvWDÆÃÓÓÒvgVæ7F–öâsöÆDvWDÆÂ‚“¥µÒ’æf÷$V6‚†SÓç°¢–b†RçF—òÓÒvv7Fòr—&WGW&ã°¢–b‚7G&–ær†RæfV6†ÇÂrr’ç7F'G5v—F‚‡&Vb’—&WGW&ã°¢6öç7B–CÕôÄEôõ$U5¶Ræ6FVv÷&–×ÇÂv÷G&÷2s°¢÷WE·–EÓÒ†÷WE·–E×ÇÃ’²‚¶RæÖöçF÷ÇÃ“°¢Ò“°¢&WGW&â÷WC°§Ğ¦gVæ7F–öâ&VæFW%&W7WVW7Fò‚—°¢6öç7Bæ–õ6VÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w&W2Öæ–òr“°¢6öç7BÖW56VÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w&W2ÖÖW2r“°¢6öç7Bæ÷sÖæWrFFR‚“°¢–b†æ–õ6VÂbbæ–õ6VÂæ÷F–öç2æÆVæwF‚—°¢³##BÃ##RÃ##bÃ##uÒæf÷$V6‚‡“Óç¶6öç7BóÖFö7VÖVçBæ7&VFTVÆVÖVçB‚v÷F–öâr“¶òçfÇVS×“¶òçFW‡D6öçFVçC×“¶–b‡“ÓÓÖæ÷rævWDgVÆÅ–V"‚’–òç6VÆV7FVC×G'VS¶æ–õ6VÂæVæD6†–ÆB†ò“·Ò“°¢Ğ¢–b†ÖW56VÂbbÖW56VÂæ÷F–öç2æÆVæwF‚—°¢²tVæW&òrÂtfV'&W&òrÂtÖ'¦òrÂt'&–ÂrÂtÖ–òrÂt§Væ–òrÂt§VÆ–òrÂtv÷7FòrÂu6WF–VÖ'&RrÂtö7GV'&RrÂtæ÷f–VÖ'&RrÂtF–6–VÖ'&RuÒæf÷$V6‚‚†ÒÆ’“Óç¶6öç7BóÖFö7VÖVçBæ7&VFTVÆVÖVçB‚v÷F–öâr“¶òçfÇVSÖ’³¶òçFW‡D6öçFVçCÖÓ¶–b†“ÓÓÖæ÷rævWDÖöçF‚‚’–òç6VÆV7FVC×G'VS¶ÖW56VÂæVæD6†–ÆB†ò“·Ò“°¢Ğ¢6öç7Bæ–ó×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&W2Öæ–òr“òçfÇVWÇÆæ÷rævWDgVÆÅ–V"‚’“°¢6öç7BÖW3×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&W2ÖÖW2r“òçfÇVWÇÆæ÷rævWDÖöçF‚‚’³“°¢6öç7B¶W“×&W4¶W’†æ–òÆÖW2“°¢6öç7BFF×&W4vWDFF‚“°¢6öç7BW&–öFôFFÖFF¶¶W•×ÇÇ·Ó°¢6öç7B6G3×W&–öFôFFæ6G7ÇÅ$U5ô4E5ôDTdTÅBæÖ†3Óâ‡²ââæ2Æ'VFvWC£ÆV¦V7WFFó£Ò’“°¢òòóc¢V¦V7WFFò$TÂFW6FRVÂÆ–'&òF–&–òFVÂW,:ÖöFòâ6’†’§W7FRÖçVÀ¢òòƒâ’ÖæFW6S²6’æòÂ6RW6VÂ&VÂFVÂF–&–òWFöÜ:F–6ÖVçFRà¢6öç7B&VÃÕ÷&W4V¦V7WFFõ&VÂ†æ–òÆÖW2“°¢6G2æf÷$V6‚†3Óç¶2å÷&VÃ×&VÅ¶2æ–E×ÇÃ¶2åöV¦V3Ò†2æV¦V7WFFóã“ö2æV¦V7WFFó¦2å÷&VÃ·Ò“°¢6öç7BF÷FÄ'VFvWCÖ6G2ç&VGV6R‚‡2Æ2“Óç2²†2æ'VFvWGÇÃ’Ã“°¢6öç7BF÷FÄV¦V3Ö6G2ç&VGV6R‚‡2Æ2“Óç2²†2åöV¦V7ÇÃ’Ã“°¢6öç7BF÷FÅ&VÃÖ6G2ç&VGV6R‚‡2Æ2“Óç2²†2å÷&VÇÇÃ’Ã“°¢6öç7BF—7×F÷FÄ'VFvWB×F÷FÄV¦V3°¢6öç7B7C×F÷FÄ'VFvWCãôÖF‚ç&÷VæB‡F÷FÄV¦V2÷F÷FÄ'VFvWB£“£°¢6öç7B6WEFW‡CÒ†–BÇb“Óç¶6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B†–B“¶–b†VÂ–VÂçFW‡D6öçFVçC×c·Ó°¢6WEFW‡B‚w&W2Ö²×F÷FÂrÆf÷&ÖD4Å‡F÷FÄ'VFvWB’“°¢6WEFW‡B‚w&W2Ö²ÖV¦V2rÆf÷&ÖD4Å‡F÷FÄV¦V2’“°¢6WEFW‡B‚w&W2Ö²ÖF—7rÆf÷&ÖD4Å†F—7’“°¢6WEFW‡B‚w&W2Ö²×7BrÇ7B²rRr“°¢6öç7B6G4VÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w&W2Ö6G2r“¶–b‚6G4VÂ’&WGW&ã°¢6G4VÂæ–ææW$…DÔÃÖ6G2æÖ‚†2Æ’“Óç°¢6öç7BV¦V3Ö2åöV¦V7ÇÃ°¢6öç7B7D3Ö2æ'VFvWCãôÖF‚ç&÷VæB†V¦V2ö2æ'VFvWB£“£°¢6öç7B&$6öÆ÷#×7D3ãÓòwf"‚ÒÖFævW"’s§7D3ãÓƒòwf"‚Ò×v&â’s¦2æ6öÆ÷#°¢6öç7B6ö'&SÖ2æ'VFvWCãbfV¦V3æ2æ'VFvWC°¢6öç7B&VÅFsÖ2å÷&VÃãöÇ7â7G–ÆSÒ&föçB×6—¦S£’ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2’"F—FÆSÒ$v7Fò&VÂ&Vv—7G&FòVâVÂÆ–'&òF–&–òW7FRÖW2#ï	ù9"&VÂG¶f÷&ÖD4Å†2å÷&VÂ—ÒG¶2æV¦V7WFFóãòr+r§W7FRÖçVÂ7F—fòs¢rwÓÂ÷7ãæ¦Ç7â7G–ÆSÒ&föçB×6—¦S£’ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#ç6–âv7F÷2VâVÂF–&–óÂ÷7ãæ°¢&WGW&æÆF—b7G–ÆSÒ&&÷&FW#£‚6öÆ–BG·6ö'&Sòwf"‚ÒÖFævW"’s¢wf"‚ÒÖ&÷&FW#"’wÓ¶&÷&FW"×&F—W3£‡ƒ·FF–æs£'‚G‚#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£‡ƒ¶Ö&v–âÖ&÷GFöÓ£G‚#à¢Ç7â7G–ÆSÒ&föçB×6—¦S£g‚#âG¶2æ–6öçÓÂ÷7ãà¢Ç7â7G–ÆSÒ&föçB×vV–v‡C£c¶föçB×6—¦S£'ƒ¶fÆWƒ£#âG¶W66T‡FÖÂ†2æÆ&VÂ—ÓÂ÷7ãà¢Ç7â7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#¢G¶&$6öÆ÷'Ó¶föçB×vV–v‡C£s¶&6¶w&÷VæC¢G¶&$6öÆ÷'Ó##·FF–æs£'‚gƒ¶&÷&FW"×&F—W3£7‚#âG·7D7ÒRG·6ö'&Sòr)ªs¢rwÓÂ÷7ãà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&Ö&v–âÖ&÷GFöÓ£—‚#âG·&VÅFwÓÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3£g"g#¶v£‡‚#à¢ÆF—b6Æ73Ò&f–VÆBÖw&÷W"7G–ÆSÒ&Ö&v–ã£#ãÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ#å&W7WVW7Fò„4Å“ÂöÆ&VÃãÆ–çWB6Æ73Ò&f–VÆBÖ–çWB"–CÒ'&W2Ö6BÖ"ÒG¶—Ò"G—SÒ&çVÖ&W""Ö–ãÒ#"7FWÒ#"fÇVSÒ"G¶2æ'VFvWGÇÂrwÒ"Æ6V†öÆFW#Ò#"öæ–çWCÒ'&W5&Wf–Wt&"‚G¶—Ò’#ãÂöF—cà¢ÆF—b6Æ73Ò&f–VÆBÖw&÷W"7G–ÆSÒ&Ö&v–ã£#ãÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ#äV¦V7WFFò†§W7FRÖçVÂ“ÂöÆ&VÃãÆ–çWB6Æ73Ò&f–VÆBÖ–çWB"–CÒ'&W2Ö6BÖRÒG¶—Ò"G—SÒ&çVÖ&W""Ö–ãÒ#"7FWÒ#"fÇVSÒ"G¶2æV¦V7WFF÷ÇÂrwÒ"Æ6V†öÆFW#Ò&WFó¢G¶2å÷&VÇÇÃÒ"öæ–çWCÒ'&W5&Wf–Wt&"‚G¶—Ò’#ãÂöF—cà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£‡ƒ¶†V–v‡C£gƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6S2“¶&÷&FW"×&F—W3£7ƒ¶÷fW&fÆ÷s¦†–FFVâ"–CÒ'&W2Ö&"ÒG¶—Ò#à¢ÆF—b7G–ÆSÒ&†V–v‡C£S·v–GFƒ¢G´ÖF‚æÖ–â‡7D2Ã—ÒS¶&6¶w&÷VæC¢G¶&$6öÆ÷'Ó¶&÷&FW"×&F—W3£7ƒ·G&ç6—F–öã§v–GF‚ã72#ãÂöF—cà¢ÂöF—cà¢ÂöF—cæ°¢Ò’æ¦ö–â‚rr“°¢6öç7B6VÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w&W2×&VÂÖ6r“°¢–b†6VÂ’6VÂæ–ææW$…DÔÃ×F÷FÅ&VÃãöV¦V7WFFò&VÂFVÂÆ–'&òF–&–òW7FRW,:ÖöFó¢Æ"7G–ÆSÒ&6öÆ÷#§f"‚ÒÖFævW"’#âG¶f÷&ÖD4Å‡F÷FÅ&VÂ—ÓÂö#ââFV¦&§W7FRÖçVÂ"f<:Öò&W6&ÆòWFöÜ:F–6ÖVçFRæ¢u&Vv—7G&v7F÷2VâVÂÆ–'&òF–&–ò’VÂV¦V7WFFò6RÆÆVæ6öÆòâs°¢G'—·&VæFW$'&V´WfVâ‚“·Ö6F6‚†R—·Ğ§Ğ¢òò)H)HTåDòDRUT”Ä”%$”òò4õ5Dõ2d”¤õ2…’)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢òò7\:çFò†’VRfVæFW"†æWFò’ÂÖW2&7V'&—"Æ÷26÷7F÷2f–¦÷2ÂFFòVÀ¢òòÖ&vVâFR6öçG&–'V6œ;6â&öÖVF–òâ'&V²ÖWfVâÒ6÷7F÷2f–¦÷2òÖ&vVâRà¦6öç7Bô4õ5Dõ5ôd”¤õ5ô´U“ÒwF†VÆ%ö6÷7F÷5öf–¦÷5÷cs°¦gVæ7F–öâö6÷7F÷4f–¦÷2‚—°¢6öç7Bc×'6TfÆöB†Æö6Å7F÷&vRævWD—FVÒ…ô4õ5Dõ5ôd”¤õ5ô´U’’“°¢–b‡cã—&WGW&âc°¢òòfÆÆ&6³¢&W7WVW7FòF÷FÂFVÂÖW2Vâ7W'6ò‡6’W7L:6&vFò¢G'—¶6öç7Bæ÷sÖæWrFFR‚“¶6öç7B¶W“×&W4¶W’†æ÷rævWDgVÆÅ–V"‚’Ææ÷rævWDÖöçF‚‚’³“¶6öç7BCÒ‡&W4vWDFF‚•¶¶W•×ÇÇ·Ò’æ6G7ÇÅµÓ¶6öç7BC×Bç&VGV6R‚‡2Æ2“Óç2²†2æ'VFvWGÇÃ’Ã“¶–b‡Cã—&WGW&âC·Ö6F6‚†R—·Ğ¢&WGW&â°§Ğ¦gVæ7F–öâ6WD6÷7F÷4f–¦÷2‚—°¢6öç7B7W#Õö6÷7F÷4f–¦÷2‚“°¢6öç7Bc×&ö×B‚t6÷7F÷2f–¦÷2ÖVç7VÆW2„4Å“¢'&–VæFòÂ7VVÆF÷2Â6W'f–6–÷2Â6ögGv&Râââ‡f<:ÖòÒW6"VÂF÷FÂFVÂ&W7WVW7Fò’rÆ7W#õ7G&–ær†7W"“¢rr“°¢–b‡cÓÓÖçVÆÂ—&WGW&ã¶6öç7BãÔÖF‚ç&÷VæB‡'6TfÆöB…7G&–ær‡b’ç&WÆ6R‚õµåÆBâÕÒörÂrr’—ÇÃ“°¢–b†ãã–Æö6Å7F÷&vRç6WD—FVÒ…ô4õ5Dõ5ôd”¤õ5ô´U’Å7G&–ær†â’“¶VÇ6RÆö6Å7F÷&vRç&VÖ÷fT—FVÒ…ô4õ5Dõ5ôd”¤õ5ô´U’“°¢Fö7B†ããò~)É26÷7F÷2f–¦÷3¢r¶f÷&ÖD4Å†â“¢t6÷7F÷2f–¦÷3¢6RW6,:VÂ&W7WVW7FòrÂw7V66W72r“°¢G'—·&VæFW$'&V´WfVâ‚“·Ö6F6‚†R—·Ğ§Ğ¦gVæ7F–öâöÖ&vVä6öçG&–'V6–öâ‚—°¢òò&Vf–W&RVÂÖ&vVâ&VÂFRÆ2Ì:ÖæV2FRæVvö6–ó²6’æòÂVÂÖ&vVâvÆö&Âà¢G'—¶–b‡G—Vöb&VçF&–Æ–FDÆ–æV3ÓÓÒvgVæ7F–öâr—¶6öç7BÃ×&VçF&–Æ–FDÆ–æV2‚“¶6öç7B&WcÔÂç&VGV6R‚‡2ÆÂ“Óç2¶Âç&WbÃ’ÇWF–ÃÔÂç&VGV6R‚‡2ÆÂ“Óç2¶ÂçWF–ÂÃ“¶–b‡&Wcã—&WGW&âWF–Â÷&Wb£·×Ö6F6‚†R—·Ğ¢G'—¶–b‡G—VöböÖ&vVå&öÖVF–ôvÆö&ÃÓÓÒvgVæ7F–öâr—¶6öç7BÓÕöÖ&vVå&öÖVF–ôvÆö&Â‚“¶–b†ÒÖçVÆÂbfÓã—&WGW&âÓ·×Ö6F6‚†R—·Ğ¢&WGW&âC°§Ğ¦gVæ7F–öâ÷fVçFæWFÖW2‚—°¢G'—¶6öç7Bæ÷sÖæWrFFR‚“¶6öç7B–æ“ÖæWrFFR†æ÷rævWDgVÆÅ–V"‚’Ææ÷rævWDÖöçF‚‚’Ã’ævWEF–ÖR‚“°¢&WGW&â‡7FFRçVF–F÷7ÇÅµÒ’æf–ÇFW"‡Óç¶6öç7Bc×æf–VÆG3¶–b‚†e²tW7FFòVF–Fòu×ÇÂrr“ÓÓÒt6æ6VÆFòr—&WGW&âfÇ6S¶6öç7BC×æ7&VFVEF–ÖSöæWrFFR‡æ7&VFVEF–ÖR’ævWEF–ÖR‚“£·&WGW&âCãÖ–æ“·Ò’ç&VGV6R‚‡2Ç“Óç2²‡æf–VÆG5²tÖöçFòF÷FÂ„4Å’u×ÇÃ’óã’Ã“°¢Ö6F6‚†R—·&WGW&â·Ğ§Ğ¦gVæ7F–öâ÷VçFôWV–Æ–'&–ò‚—°¢6öç7Bf–¦÷3Õö6÷7F÷4f–¦÷2‚“¶6öç7BÖ&vVãÕöÖ&vVä6öçG&–'V6–öâ‚“°¢6öç7B&SÖÖ&vVããöf–¦÷2ò†Ö&vVâó“£°¢6öç7BfVçFÕ÷fVçFæWFÖW2‚“°¢&WGW&â¶f–¦÷2ÆÖ&vVâÆ&RÇfVçFÆfÇF¤ÖF‚æÖ‚ƒÆ&R×fVçF’Ç7C¦&SãôÖF‚ç&÷VæB‡fVçFö&R£“£Ó°§Ğ¦gVæ7F–öâ&VæFW$'&V´WfVâ‚—°¢6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v'&V´WfVä6&Br“¶–b‚VÂ—&WGW&ã°¢6öç7BSÕ÷VçFôWV–Æ–'&–ò‚“°¢–b‚Ræf–¦÷2—¶VÂæ–ææW$…DÔÃÖÆF—b6Æ73Ò&6&B"7G–ÆSÒ'FF–æs£‚gƒ¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£‚#ãÇ7â7G–ÆSÒ&föçB×6—¦S£W‚#î)©nûˆóÂ÷7ããÇ7â7G–ÆSÒ&föçB×6—¦S£'ƒ¶6öÆ÷#§f"‚Ò×FW‡C"’#äFVf–æRGW26÷7F÷2f–¦÷2ÖVç7VÆW2&6Æ7VÆ"VÂVçFòFRWV–Æ–'&–óÂ÷7ããÆ'WGFöâ6Æ73Ò&'Fâ'FâÖv†÷7B'Fâ×6Ò"7G–ÆSÒ&Ö&v–âÖÆVgC¦WFò"öæ6Æ–6³Ò'6WD6÷7F÷4f–¦÷2‚’#äFVf–æ—"6÷7F÷2f–¦÷3Âö'WGFöããÂöF—cæ·&WGW&ã·Ğ¢òò6öâÖ&vVâFR6öçG&–'V6œ;6â(šCVÂWV–Æ–'&–òW2–æÆ6ç¦&ÆR†&SÖf–¦÷2óŞ(‰â“¢æğ¢òò6RVVFRFV6Æ&"&7V&–W'Fò"VçVR†–fVçF2â6R×VW7G&ÆW'FÂæòfW&FRà¢6öç7B6–äÖ&vVãÖRæÖ&vVãÃÓ°¢6öç7B7V&–W'FóÒ6–äÖ&vVâbfRçfVçFãÖRæ&S°¢6öç7BWF–Å&÷“ÔÖF‚ç&÷VæB‚†RçfVçF¦RæÖ&vVâó’ÖRæf–¦÷2“°¢6öç7B&÷&FSÖ7V&–W'Fóòw&v&ƒÃ#"ÃsÃã2’s§6–äÖ&vVãòw&v&ƒ#SRÃ“Ã“Ãã3R’s¢w&v&ƒ#SRÃsÃÃã2’s°¢6öç7B&'&Ö7V&–W'Fóòwf"‚ÒÖ66VçC2’s§6–äÖ&vVãòwf"‚ÒÖFævW"’s¢wf"‚Ò×v&â’s°¢VÂæ–ææW$…DÔÃÖÆF—b6Æ73Ò&6&B"7G–ÆSÒ&&÷&FW"Ö6öÆ÷#¢G¶&÷&FWÒ#à¢ÆF—b6Æ73Ò&6&BÖ†VFW"#ãÇ7â6Æ73Ò&6&B×F—FÆR#î)©nûˆòVçFòFRWV–Æ–'&–óÂ÷7ããÆ'WGFöâ6Æ73Ò&'Fâ'FâÖv†÷7B'Fâ×6Ò"7G–ÆSÒ&Ö&v–âÖÆVgC¦WFò"öæ6Æ–6³Ò'6WD6÷7F÷4f–¦÷2‚’#î)©ûˆò6÷7F÷2f–¦÷3Âö'WGFöããÂöF—cà¢ÆF—b7G–ÆSÒ'FF–æs£G‚g‚#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£‡ƒ¶fÆW‚×w&§w&¶Ö&v–âÖ&÷GFöÓ£'‚#à¢ÆF—b6Æ73Ò&f2Ö·’"7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£‚#ãÇ7â6Æ73Ò&f2Ö·’ÖÆ&Â#ä6÷7F÷2f–¦÷2öÖW3Â÷7ããÇ7â6Æ73Ò&f2Ö·’×fÂ#âG¶f÷&ÖD4Å†Ræf–¦÷2—ÓÂ÷7ããÂöF—cà¢ÆF—b6Æ73Ò&f2Ö·’"7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£‚#ãÇ7â6Æ73Ò&f2Ö·’ÖÆ&Â#äÖ&vVâ6öçG&–"ãÂ÷7ããÇ7â6Æ73Ò&f2Ö·’×fÂ"G·6–äÖ&vVãòr7G–ÆSÒ&6öÆ÷#§f"‚ÒÖFævW"’"s¢rwÓâG¶RæÖ&vVâçFôf—†VBƒ—ÒSÂ÷7ããÂöF—cà¢ÆF—b6Æ73Ò&f2Ö·’"7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£3‚#ãÇ7â6Æ73Ò&f2Ö·’ÖÆ&Â#åVçFòFRWV–Æ–'&–óÂ÷7ããÇ7â6Æ73Ò&f2Ö·’×fÂ"7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ66VçC"’#âG·6–äÖ&vVãò~(	Bs¦f÷&ÖD4Å„ÖF‚ç&÷VæB†Ræ&R’—ÓÂ÷7ããÂöF—cà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶Ö&v–âÖ&÷GFöÓ£G‚#ãÇ7ãåfVçFFVÂÖW3¢G¶f÷&ÖD4Å„ÖF‚ç&÷VæB†RçfVçF’—ÓÂ÷7ããÇ7ãâG·6–äÖ&vVãòrs¦Rç7B²rRFVÂWV–Æ–'&–òwÓÂ÷7ããÂöF—cà¢ÆF—b7G–ÆSÒ&†V–v‡C£'ƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6S2“¶&÷&FW"×&F—W3£Wƒ¶÷fW&fÆ÷s¦†–FFVã·÷6—F–öã§&VÆF—fR#à¢ÆF—b7G–ÆSÒ&†V–v‡C£S·v–GFƒ¢G·6–äÖ&vVãó¤ÖF‚æÖ–âƒÆRç7B—ÒS¶&6¶w&÷VæC¢G¶&'&Ó¶&÷&FW"×&F—W3£W‚#ãÂöF—cà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£ƒ¶föçB×6—¦S£'ƒ¶6öÆ÷#§f"‚Ò×FW‡C"’#âG·6–äÖ&vVà¢ö)ªûˆò6öâVÂÖ&vVâFR6öçG&–'V6œ;6â7GVÂ‚G¶RæÖ&vVâçFôf—†VBƒ—ÒR’æò7V'&W2Æ÷26÷7F÷2f–¦÷3¢6FfVçF÷'FCòÖVæ÷2ÂWV–Æ–'&–òâ&Wf—66÷7F÷2&VÆW2ò&V6–÷2âWF–Æ–FB&÷–V7FFFVÂÖW3¢Æ"7G–ÆSÒ&6öÆ÷#§f"‚ÒÖFævW"’#âG¶f÷&ÖD4Å‡WF–Å&÷’—ÓÂö#âæ ¢¦7V&–W'Fğ¢ö)ÈRWV–Æ–'&–ò7V&–W'FòâWF–Æ–FB&÷–V7FFFVÂÖW3¢Æ"7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ66VçC2’#âG¶f÷&ÖD4Å‡WF–Å&÷’—ÓÂö#âæ ¢¦fÇFâÆ"7G–ÆSÒ&6öÆ÷#§f"‚Ò×v&â’#âG¶f÷&ÖD4Å„ÖF‚ç&÷VæB†RæfÇF’—ÓÂö#âFRfVçFæWF&7V'&—"Æ÷26÷7F÷2f–¦÷2G¶RæÖ&vVããö(˜‚G¶f÷&ÖD4Å„ÖF‚ç&÷VæB†RæfÇFò†RæÖ&vVâó’’—ÒVâfVçF2ÂÖ&vVâ7GVÂ–¢rwÒæÓÂöF—cà¢ÂöF—cà¢ÂöF—cæ°§Ğ¦gVæ7F–öâ&W5&Wf–Wt&"†’—°¢6öç7B#×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B†&W2Ö6BÖ"ÒG¶—Ö“òçfÇVR—ÇÃ°¢6öç7BS×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B†&W2Ö6BÖRÒG¶—Ö“òçfÇVR—ÇÃ°¢6öç7B7CÖ#ãôÖF‚æÖ–âƒÄÖF‚ç&÷VæB†Rö"£’“£°¢6öç7B&$VÃÖFö7VÖVçBævWDVÆVÖVçD'”–B†&W2Ö&"ÒG¶—Ö“°¢–b†&$VÂ—¶6öç7B–ææW#Ö&$VÂæf—'7DVÆVÖVçD6†–ÆC¶–b†–ææW"––ææW"ç7G–ÆRçv–GFƒ×7B²rRs·Ğ§Ğ¦gVæ7F–öâ&W4wV&F"‚—°¢6öç7Bæ–ó×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&W2Öæ–òr“òçfÇVWÇÆæWrFFR‚’ævWDgVÆÅ–V"‚’“°¢6öç7BÖW3×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&W2ÖÖW2r“òçfÇVWÇÆæWrFFR‚’ævWDÖöçF‚‚’³“°¢6öç7B¶W“×&W4¶W’†æ–òÆÖW2“°¢6öç7BFF×&W4vWDFF‚“°¢6öç7B6G3Õ$U5ô4E5ôDTdTÅBæÖ‚†2Æ’“Óâ‡²ââæ2Æ'VFvWC§'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B†&W2Ö6BÖ"ÒG¶—Ö“òçfÇVR—ÇÃÆV¦V7WFFó§'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B†&W2Ö6BÖRÒG¶—Ö“òçfÇVR—ÇÃÒ’“°¢FF¶¶W•Ó×¶6G7Ó·&W56WDFF†FF“°¢&VæFW%&W7WVW7Fò‚“·Fö7B‚~)É2&W7WVW7FòwV&FFòrÂw7V66W72r“°§Ğ¦gVæ7F–öâ&W4FD6FVv÷&–‚—°¢Fö7B‚tVF—FÆ26FVv÷,:Ö2F—&V7FÖVçFRVâÆ÷26×÷2(	B,;7†–ÖÖVçFR6FVv÷,:Ö27W7FöÒrÂv–æfòr“°§Ğ¦gVæ7F–öâ&W4W‡÷'D55b‚—°¢6öç7Bæ–ó×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&W2Öæ–òr“òçfÇVWÇÆæWrFFR‚’ævWDgVÆÅ–V"‚’“°¢6öç7BÖW3×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&W2ÖÖW2r“òçfÇVWÇÆæWrFFR‚’ævWDÖöçF‚‚’³“°¢6öç7B¶W“×&W4¶W’†æ–òÆÖW2“¶6öç7BFF×&W4vWDFF‚“¶6öç7BW&–öFôFFÖFF¶¶W•×ÇÇ·Ó°¢6öç7B6G3×W&–öFôFFæ6G7ÇÅ$U5ô4E5ôDTdTÅBæÖ†3Óâ‡²ââæ2Æ'VFvWC£ÆV¦V7WFFó£Ò’“°¢6öç7B&÷w3Õµ²t6FVv÷,:ÖrÂu&W7WVW7FòrÂtV¦V7WFFòrÂtF—7öæ–&ÆRrÂrRV¦V7V6œ;6âuÒÂââæ6G2æÖ†3Óå¶2æÆ&VÂÆ2æ'VFvWBÆ2æV¦V7WFFòÆ2æ'VFvWBÖ2æV¦V7WFFòÆ2æ'VFvWCãôÖF‚ç&÷VæB†2æV¦V7WFFòö2æ'VFvWB£’²rRs¢~(	BuÒ•Ó°¢6öç7B77c×&÷w2æÖ‡#Óç"æÖ‡cÓæ"Gµ7G&–ær‡b’ç&WÆ6R‚ò"örÂr""r—Ò&’æ¦ö–â‚rÂr’’æ¦ö–â‚uÆâr“°¢6öç7BÖFö7VÖVçBæ7&VFTVÆVÖVçB‚vr“¶æ‡&VcÒvFF§FW‡Bö77c¶6†'6WC×WFbÓ‚Îû»òr¶Væ6öFUU$”6ö×öæVçB†77b“¶æF÷væÆöCÖ&W7WVW7FõòG¶¶W—Òæ77f¶æ6Æ–6²‚“°§Ğ ¢òò)H)H4Ä5TÄDõ$2Ì84U"òä\94â†–æÆ–æRVâçVWfôVF—F"6÷F—¦6œ;6â’)H)H)H)H)H)H ¢òòæVÆW2;¦æ–6÷2vVæW&F÷2÷"¥3²6R×VWfVâÂ†÷7BFVÂ6öçFW‡Fò7F—fğ¢òò‚vârÒçVWf6÷F—¦6œ;6âÂvRrÒÖöFÂVF—F"’–wVÂVRÆ6Æ7VÆF÷&4Bà¦ÆWBöÇ7$W‡G&3ÕµÒÅöæVôW‡G&3ÕµÓ°¦6öç7B÷6Æ5F&vWC×¶Ç7#¢vârÆæVó¢vâwÓ° ¢òò–ç6W'FVæf–ÆFR:×FVÒVâVÂf÷&×VÆ&–òFVÂ6öçFW‡Fò–æF–6Fğ¦gVæ7F–öâ6Æ4–ç6W'E&÷r†7G‚Ç¶FW62ÇVæBÆ6÷7FõVæ—BÇfVçFVæ—GÒ—°¢–b†7GƒÓÓÒvRr—°¢FDVF—D—FVÕ&÷r‡¶FW62ÇVæBÆ6÷7FõVæ—BÇfVçFVæ—GÒ“°¢&WGW&ã°¢Ğ¢6öç7B6öçF–æW#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v—FV×46öçF–æW"r“°¢–b‚6öçF–æW"—·Fö7B‚tf÷&×VÆ&–òFR6÷F—¦6œ;6âæòVæ6öçG&FòrÂvW'&÷"r“·&WGW&ã·Ğ¢FD—FVÕ&÷r‚“°¢6öç7B&÷w3Ö6öçF–æW"çVW'•6VÆV7F÷$ÆÂ‚ræ—FVÒ×&÷rr“°¢6öç7BÆ7C×&÷w5·&÷w2æÆVæwF‚ÓÓ°¢–b†Æ7B—°¢Æ7BçVW'•6VÆV7F÷"‚ræ—FVÒÖFW62r’çfÇVSÖFW63°¢Æ7BçVW'•6VÆV7F÷"‚ræ—FVÒ×VæBr’çfÇVS×VæC°¢Æ7BçVW'•6VÆV7F÷"‚ræ—FVÒÖ6÷7Fòr’çfÇVSÖ6÷7FõVæ—C°¢Æ7BçVW'•6VÆV7F÷"‚ræ—FVÒ×fVçFr’çfÇVS×fVçFVæ—C°¢Ğ¢WFFT—FVÕF÷FÂ‚“°§Ğ ¦6öç7Bõ4Ä3×°¢Ç7#§¶6öÆ÷#¢r6cS–S"rÇ&v&¢s#CRÃS‚ÃrÇF—FÆS¢	ùHb6Æ7VÆF÷&6÷'FRÌ:6W"rÆFVdÖ&vVã£cÒÀ¢æVó§¶6öÆ÷#¢r6c“s3brÇ&v&¢s#C’ÃRÃ#"rÇF—FÆS¢	ù*6Æ7VÆF÷&æ\;6âòÄTBrÆFVdÖ&vVã£cWĞ§Ó° ¦gVæ7F–öâ6Æ5æVÄ‡FÖÂ†¶–æB—°¢6öç7BÕõ4Ä5¶¶–æEÓ°¢6öç7B†G#ÖÆF—b7G–ÆSÒ&&6¶w&÷VæC§&v&‚G·ç&v&ÒÃã‚“·FF–æs£‚Gƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&‚G·ç&v&ÒÃã"“¶F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶Æ–vâÖ—FV×3¦6VçFW#¶fÆW‚×w&§w&¶v£‚#à¢Ç7â7G–ÆSÒ&föçB×vV–v‡C£s¶föçB×6—¦S£7ƒ¶6öÆ÷#¢G·æ6öÆ÷'Ò#âG·çF—FÆWÓÂ÷7ãà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£‚#à¢ÆÆ&VÂ7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶Ö&v–ã£#äÖ&vVãÂöÆ&VÃà¢Ç7â–CÒ"G¶¶–æGÒÖÖ&vVâÖÆ&Â"7G–ÆSÒ&föçB×6—¦S£7ƒ¶föçB×vV–v‡C£s¶föçBÖfÖ–Ç“¢t¦WD'&–ç2ÖöæòrÆÖöæ÷76S¶6öÆ÷#¢G·æ6öÆ÷'Ó¶Ö–â×v–GFƒ£3‡ƒ·FW‡BÖÆ–vã§&–v‡B#âG·æFVdÖ&vVçÒSÂ÷7ãà¢Æ–çWBG—SÒ'&ævR"–CÒ"G¶¶–æGÒÖÖ&vVâ"Ö–ãÒ#"ÖƒÒ#“"fÇVSÒ"G·æFVdÖ&vVçÒ"öæ–çWCÒ'6Æ5WFFR‚rG¶¶–æGÒr’"7G–ÆSÒ'v–GFƒ£3ƒ¶66VçBÖ6öÆ÷#¢G·æ6öÆ÷'Ó¶7W'6÷#§ö–çFW"#à¢ÂöF—cà¢ÂöF—cæ°¢6öç7Bf–VÆG3Ö¶–æCÓÓÒvÇ7"p¢öÆF—b6Æ73Ò&f–VÆBÖw&÷W"7G–ÆSÒ&w&–BÖ6öÇVÖã£òÓ#ãÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ#äFW67&—6œ;6ãÂöÆ&VÃãÆ–çWB6Æ73Ò&f–VÆBÖ–çWB"–CÒ&Ç7"ÖFW62"Æ6V†öÆFW#Ò&V¢â6÷'FRÆövò7,:ÖÆ–6ò6ÖÒ#ãÂöF—cà¢ÆF—b6Æ73Ò&f–VÆBÖw&÷W#ãÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ#äÖFW&–ÃÂöÆ&VÃà¢Ç6VÆV7B6Æ73Ò&f–VÆB×6VÆV7B"–CÒ&Ç7"ÖÖB"öæ6†ævSÒ'6Æ5WFFR‚vÇ7"r’#à¢Æ÷F–öâfÇVSÒ##ƒ#ä7,:ÖÆ–6ò6ÖÒ(	BC"ãƒö6Ü+#Âö÷F–öãà¢Æ÷F–öâfÇVSÒ#3S#ä7,:ÖÆ–6òVÖÒ(	BC2ãSö6Ü+#Âö÷F–öãà¢Æ÷F–öâfÇVSÒ#Cƒ#äÔDb6ÖÒ(	BCCƒö6Ü+#Âö÷F–öãà¢Æ÷F–öâfÇVSÒ#sS#äÔDbfÖÒ(	BCsSö6Ü+#Âö÷F–öãà¢Æ÷F–öâfÇVSÒ###ä6'L;6â6÷''VvFò(	BC#ö6Ü+#Âö÷F–öãà¢Æ÷F–öâfÇVSÒ###ä7VW&òò6–Ö–Â(	BCã#ö6Ü+#Âö÷F–öãà¢Æ÷F–öâfÇVSÒ#3S#åFVÆòf–VÇG&ò(	BC3Sö6Ü+#Âö÷F–öãà¢Â÷6VÆV7CãÂöF—cà¢ÆF—b6Æ73Ò&f–VÆBÖw&÷W#ãÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ#ì8&V6÷'FR†6Ü+"“ÂöÆ&VÃãÆ–çWB6Æ73Ò&f–VÆBÖ–çWB"–CÒ&Ç7"Ö&V"G—SÒ&çVÖ&W""Ö–ãÒ#"fÇVSÒ#"öæ–çWCÒ'6Æ5WFFR‚vÇ7"r’#ãÂöF—cà¢ÆF—b6Æ73Ò&f–VÆBÖw&÷W#ãÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ#âRFW7W&F–6–óÂöÆ&VÃãÆ–çWB6Æ73Ò&f–VÆBÖ–çWB"–CÒ&Ç7"ÖFW7"G—SÒ&çVÖ&W""Ö–ãÒ#"ÖƒÒ#c"fÇVSÒ#R"öæ–çWCÒ'6Æ5WFFR‚vÇ7"r’#ãÂöF—cà¢ÆF—b6Æ73Ò&f–VÆBÖw&÷W#ãÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ#ä6çF–FB6÷–3ÂöÆ&VÃãÆ–çWB6Æ73Ò&f–VÆBÖ–çWB"–CÒ&Ç7"×G’"G—SÒ&çVÖ&W""Ö–ãÒ#"fÇVSÒ#"öæ–çWCÒ'6Æ5WFFR‚vÇ7"r’#ãÂöF—cà¢ÆF—b6Æ73Ò&f–VÆBÖw&÷W#ãÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ#åBâ6÷'FR†Ö–â“ÂöÆ&VÃãÆ–çWB6Æ73Ò&f–VÆBÖ–çWB"–CÒ&Ç7"×BÖ6÷'FR"G—SÒ&çVÖ&W""Ö–ãÒ#"fÇVSÒ#"öæ–çWCÒ'6Æ5WFFR‚vÇ7"r’#ãÂöF—cà¢ÆF—b6Æ73Ò&f–VÆBÖw&÷W#ãÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ#åBâw&&Fò†Ö–â“ÂöÆ&VÃãÆ–çWB6Æ73Ò&f–VÆBÖ–çWB"–CÒ&Ç7"×BÖw&""G—SÒ&çVÖ&W""Ö–ãÒ#"fÇVSÒ#"öæ–çWCÒ'6Æ5WFFR‚vÇ7"r’#ãÂöF—cà¢ÆF—b6Æ73Ò&f–VÆBÖw&÷W#ãÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ#åF&–fÜ:V–æ‚Bö‡"“ÂöÆ&VÃãÆ–çWB6Æ73Ò&f–VÆBÖ–çWB"–CÒ&Ç7"×F&–f"G—SÒ&çVÖ&W""Ö–ãÒ#"fÇVSÒ#ƒ"öæ–çWCÒ'6Æ5WFFR‚vÇ7"r’#ãÂöF—cà¢ÆF—b6Æ73Ò&f–VÆBÖw&÷W#ãÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ#äÖæòFRö'&†Ö–â“ÂöÆ&VÃãÆ–çWB6Æ73Ò&f–VÆBÖ–çWB"–CÒ&Ç7"ÖÖFò"G—SÒ&çVÖ&W""Ö–ãÒ#"fÇVSÒ#"öæ–çWCÒ'6Æ5WFFR‚vÇ7"r’#ãÂöF—cæ ¢¦ÆF—b6Æ73Ò&f–VÆBÖw&÷W"7G–ÆSÒ&w&–BÖ6öÇVÖã£òÓ#ãÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ#äFW67&—6œ;6ãÂöÆ&VÃãÆ–çWB6Æ73Ò&f–VÆBÖ–çWB"–CÒ&æVòÖFW62"Æ6V†öÆFW#Ò&V¢âÆWG&W&òæVöâuF†RÆ"r&÷6ƒ6Ò#ãÂöF—cà¢ÆF—b6Æ73Ò&f–VÆBÖw&÷W#ãÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ#åFV6æöÆö|:ÖÂöÆ&VÃà¢Ç6VÆV7B6Æ73Ò&f–VÆB×6VÆV7B"–CÒ&æVò×F—ò"öæ6†ævSÒ'6Æ5WFFR‚væVòr’#à¢Æ÷F–öâfÇVSÒ#C##äÄTBfÆW‚6–Æ–6öæ(	BCBã#öÓÂö÷F–öãà¢Æ÷F–öâfÇVSÒ#3#äÄTB7VW&FæVöâ(	BC2ãöÓÂö÷F–öãà¢Æ÷F–öâfÇVSÒ###äæVöâv2‡f–G&–ò’(	BC"ãöÓÂö÷F–öãà¢Â÷6VÆV7CãÂöF—cà¢ÆF—b6Æ73Ò&f–VÆBÖw&÷W#ãÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ#äÆöæv—GVBGV&ò†Ò“ÂöÆ&VÃãÆ–çWB6Æ73Ò&f–VÆBÖ–çWB"–CÒ&æVòÖÆ&vò"G—SÒ&çVÖ&W""Ö–ãÒ#"7FWÒ#ã"fÇVSÒ#"öæ–çWCÒ'6Æ5WFFR‚væVòr’#ãÂöF—cà¢ÆF—b6Æ73Ò&f–VÆBÖw&÷W#ãÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ#äì+6öÆ÷&W2ò6÷'FW3ÂöÆ&VÃãÆ–çWB6Æ73Ò&f–VÆBÖ–çWB"–CÒ&æVòÖ6öÆ÷&W2"G—SÒ&çVÖ&W""Ö–ãÒ#"ÖƒÒ#‚"fÇVSÒ#"öæ–çWCÒ'6Æ5WFFR‚væVòr’#ãÂöF—cà¢ÆF—b6Æ73Ò&f–VÆBÖw&÷W#ãÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ#ä6çF–FCÂöÆ&VÃãÆ–çWB6Æ73Ò&f–VÆBÖ–çWB"–CÒ&æVò×G’"G—SÒ&çVÖ&W""Ö–ãÒ#"fÇVSÒ#"öæ–çWCÒ'6Æ5WFFR‚væVòr’#ãÂöF—cà¢ÆF—b6Æ73Ò&f–VÆBÖw&÷W#ãÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ#å6÷÷'FRò&6¶–æsÂöÆ&VÃà¢Ç6VÆV7B6Æ73Ò&f–VÆB×6VÆV7B"–CÒ&æVò×6÷÷'FR"öæ6†ævSÒ'6Æ5WFFR‚væVòr’#à¢Æ÷F–öâfÇVSÒ##å6–â6÷÷'FSÂö÷F–öãà¢Æ÷F–öâfÇVSÒ#S#ä7,:ÖÆ–6òG&ç7&VçFR(	BCRãÂö÷F–öãà¢Æ÷F–öâfÇVSÒ####ä7,:ÖÆ–6òæVw&ò(	BC#"ãÂö÷F–öãà¢Æ÷F–öâfÇVSÒ#3S#äÔDb–çFFò(	BC3RãÂö÷F–öãà¢Æ÷F–öâfÇVSÒ#SS#äW7G'V7GW&ÖWL:Æ–6(	BCSRãÂö÷F–öãà¢Â÷6VÆV7CãÂöF—cà¢ÆF—b6Æ73Ò&f–VÆBÖw&÷W#ãÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ#åG&ç6f÷&ÖF÷#ÂöÆ&VÃà¢Ç6VÆV7B6Æ73Ò&f–VÆB×6VÆV7B"–CÒ&æVò×G&ç2"öæ6†ævSÒ'6Æ5WFFR‚væVòr’#à¢Æ÷F–öâfÇVSÒ#ƒS#äW7L:æF"%b(	BC‚ãSÂö÷F–öãà¢Æ÷F–öâfÇVSÒ#S#å÷FVæ6–Fò%bó#Eb(	BCRãÂö÷F–öãà¢Æ÷F–öâfÇVSÒ##å6–âG&ç6f÷&ÖF÷#Âö÷F–öãà¢Â÷6VÆV7CãÂöF—cà¢ÆF—b6Æ73Ò&f–VÆBÖw&÷W#ãÆÆ&VÂ6Æ73Ò&f–VÆBÖÆ&VÂ#ä6öçG&öÂF–ÖÖW"÷&VÖ÷FóÂöÆ&VÃà¢Ç6VÆV7B6Æ73Ò&f–VÆB×6VÆV7B"–CÒ&æVòÖF–ÖÖW""öæ6†ævSÒ'6Æ5WFFR‚væVòr’#à¢Æ÷F–öâfÇVSÒ##å6–â6öçG&öÃÂö÷F–öãà¢Æ÷F–öâfÇVSÒ#sS#äF–ÖÖW"ÖçVÂ(	BCrãSÂö÷F–öãà¢Æ÷F–öâfÇVSÒ#C#ä6öçG&öÂ&VÖ÷Fò$b(	BCBãÂö÷F–öãà¢Æ÷F–öâfÇVSÒ####ä&ÇVWFö÷F‚(	BC#"ãÂö÷F–öãà¢Â÷6VÆV7CãÂöF—cæ°¢&WGW&âG¶†G'Ğ¢ÆF—b7G–ÆSÒ'FF–æs£‚Gƒ¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVB†WFòÖf—BÆÖ–æÖ‚ƒS‚Ãg"’“¶v£‚#âG¶f–VÆG7ÓÂöF—cà¢ÆF—b7G–ÆSÒ'FF–æs£G‚‚#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶Æ–vâÖ—FV×3¦6VçFW#¶Ö&v–âÖ&÷GFöÓ£g‚#ãÇ7â7G–ÆSÒ&föçB×6—¦S£—ƒ¶föçB×vV–v‡C£s·FW‡B×G&ç6f÷&Ó§WW&66S¶6öÆ÷#§f"‚Ò×FW‡C2’#äW‡G&2ò–ç7VÖ÷3Â÷7ããÆ'WGFöâG—SÒ&'WGFöâ"6Æ73Ò&'FâÖÖ–æ’'FâÖÖ–æ’×–VÆÆ÷r"öæ6Æ–6³Ò'6Æ4FDW‡G&‚rG¶¶–æGÒr’#â²W‡G&Âö'WGFöããÂöF—cà¢ÆF—b–CÒ"G¶¶–æGÒÖW‡G&2"7G–ÆSÒ&F—7Æ“¦fÆWƒ¶fÆW‚ÖF—&V7F–öã¦6öÇVÖã¶v£g‚#ãÂöF—cà¢ÂöF—cà¢ÆF—b–CÒ"G¶¶–æGÒÖFW6vÆ÷6R"7G–ÆSÒ'FF–æs£g‚Gƒ¶&÷&FW"×F÷£‚6öÆ–B&v&‚G·ç&v&ÒÃãR“¶föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶föçBÖfÖ–Ç“¢t¦WD'&–ç2ÖöæòrÆÖöæ÷76R#ãÂöF—cà¢ÆF—b7G–ÆSÒ'FF–æs£‚Gƒ¶&÷&FW"×F÷£‚6öÆ–B&v&‚G·ç&v&ÒÃãR“¶F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶Æ–vâÖ—FV×3¦6VçFW#¶fÆW‚×w&§w&¶v£‚#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£Gƒ¶fÆW‚×w&§w&¶föçB×6—¦S£ƒ¶Æ–vâÖ—FV×3¦6VçFW"#à¢Ç7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2’#ä6÷7FòÇ7G&öær–CÒ"G¶¶–æGÒ×"Ö6÷7Fò"7G–ÆSÒ&föçBÖfÖ–Ç“¢t¦WD'&–ç2ÖöæòrÆÖöæ÷76S¶6öÆ÷#§f"‚Ò×FW‡C"’#âCÂ÷7G&öæsãÂ÷7ãà¢Ç7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2’#äæWFòÇ7G&öær–CÒ"G¶¶–æGÒ×"ÖæWFò"7G–ÆSÒ&föçBÖfÖ–Ç“¢t¦WD'&–ç2ÖöæòrÆÖöæ÷76S¶6öÆ÷#§f"‚Ò×FW‡B’#âCÂ÷7G&öæsãÂ÷7ãà¢Ç7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2’#æ2ô•dÇ7G&öær–CÒ"G¶¶–æGÒ×"×F÷FÂ"7G–ÆSÒ&föçBÖfÖ–Ç“¢t¦WD'&–ç2ÖöæòrÆÖöæ÷76S¶6öÆ÷#¢G·æ6öÆ÷'Ó¶föçB×6—¦S£7‚#âCÂ÷7G&öæsãÂ÷7ãà¢Ç7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2’#ç÷"Væ–FBÇ7G&öær–CÒ"G¶¶–æGÒ×"×–W¦"7G–ÆSÒ&föçBÖfÖ–Ç“¢t¦WD'&–ç2ÖöæòrÆÖöæ÷76S¶6öÆ÷#§f"‚ÒÖ66VçB’#âCÂ÷7G&öæsãÂ÷7ãà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£g‚#à¢Æ'WGFöâG—SÒ&'WGFöâ"6Æ73Ò&'Fâ'FâÖv†÷7B'Fâ×6Ò"öæ6Æ–6³Ò'6Æ46ÆV"‚rG¶¶–æGÒr’"F—FÆSÒ$Æ–×–"#î(k£Âö'WGFöãà¢Æ'WGFöâG—SÒ&'WGFöâ"6Æ73Ò&'Fâ'Fâ×&–Ö'’'Fâ×6Ò"öæ6Æ–6³Ò'6Æ4Ç’‚rG¶¶–æGÒr’#î)É2w&Vv"6÷F—¦6œ;6ãÂö'WGFöãà¢ÂöF—cà¢ÂöF—cæ°§Ğ ¦gVæ7F–öâ6Æ4Vç7W&R†¶–æB—°¢ÆWBæVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B†¶–æB²rÖ–æÆ–æR×æVÂr“°¢–b‡æVÂ’&WGW&âæVÃ°¢6öç7BÕõ4Ä5¶¶–æEÓ°¢æVÃÖFö7VÖVçBæ7&VFTVÆVÖVçB‚vF—br“°¢æVÂæ–CÖ¶–æB²rÖ–æÆ–æR×æVÂs°¢æVÂç7G–ÆRæ775FW‡CÖF—7Æ“¦æöæS¶Ö&v–â×F÷£ƒ¶&÷&FW#£‚6öÆ–B&v&‚G·ç&v&ÒÃã3R“¶&÷&FW"×&F—W3£ƒ¶÷fW&fÆ÷s¦†–FFVã¶&6¶w&÷VæC§f"‚Ò×7W&f6S"–°¢æVÂæ–ææW$…DÔÃ×6Æ5æVÄ‡FÖÂ†¶–æB“°¢&WGW&âæVÃ°§Ğ ¦gVæ7F–öâ÷6Æ4'Fç2†¶–æB—·&WGW&ç¶ã¦Fö7VÖVçBævWDVÆVÖVçD'”–B†¶–æB²rÖ'FâÖâr’ÆS¦Fö7VÖVçBævWDVÆVÖVçD'”–B†¶–æB²rÖ'FâÖRr—Ó·Ğ ¦gVæ7F–öâ6Æ5FövvÆR†¶–æBÆ7G‚—°¢6öç7BæVÃ×6Æ4Vç7W&R†¶–æB“°¢6öç7B'Fç3Õ÷6Æ4'Fç2†¶–æB“°¢6öç7BÕõ4Ä5¶¶–æEÓ°¢6öç7B—4÷Vã×æVÂç7G–ÆRæF—7Æ’ÓÒvæöæRs°¢–b†—4÷Vâbe÷6Æ5F&vWE¶¶–æEÓÓÓÖ7G‚—°¢æVÂç7G–ÆRæF—7Æ“ÒvæöæRs°¢ö&¦V7BçfÇVW2†'Fç2’æf÷$V6‚†#Óç¶–b†"–"ç7G–ÆRæ&6¶w&÷VæCÒrs·Ò“°¢&WGW&ã°¢Ğ¢÷6Æ5F&vWE¶¶–æEÓÖ7Gƒ°¢6öç7B†÷7CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v6Æ2Ö†÷7BÒr¶7G‚“°¢–b††÷7B’†÷7BæVæD6†–ÆB‡æVÂ“°¢æVÂç7G–ÆRæF—7Æ“Òv&Æö6²s°¢ö&¦V7BæVçG&–W2†'Fç2’æf÷$V6‚‚…¶²Æ%Ò“Óç¶–b†"–"ç7G–ÆRæ&6¶w&÷VæCÖ³ÓÓÖ7Gƒö&v&‚G·ç&v&ÒÃãR–¢rs·Ò“°¢6Æ5WFFR†¶–æB“°§Ğ ¦gVæ7F–öâ6Æ4FDW‡G&†¶–æB—°¢†¶–æCÓÓÒvÇ7"sõöÇ7$W‡G&3¥öæVôW‡G&2’çW6‚‡¶FW63¢rrÇfÆ÷#£Ò“°¢6Æ4W‡G&5&VæFW"†¶–æB“°§Ğ¦gVæ7F–öâ6Æ4W‡G&5&VæFW"†¶–æB—°¢6öç7B'#Ö¶–æCÓÓÒvÇ7"sõöÇ7$W‡G&3¥öæVôW‡G&3°¢6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B†¶–æB²rÖW‡G&2r“¶–b‚VÂ—&WGW&ã°¢6öç7B&VcÖ¶–æCÓÓÒvÇ7"sòuöÇ7$W‡G&2s¢uöæVôW‡G&2s°¢VÂæ–ææW$…DÔÃÖ'"æÖ‚‡‚Æ’“ÓæÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£‡ƒ¶Æ–vâÖ—FV×3¦6VçFW"#à¢Æ–çWB6Æ73Ò&f–VÆBÖ–çWB"7G–ÆSÒ&fÆWƒ£"Æ6V†öÆFW#Ò$FW67&—6œ;6âW‡G&"fÇVSÒ"G¶W66T‡FÖÂ‡‚æFW62—Ò"öæ–çWCÒ"G·&VgÕ²G¶—ÕÒæFW63×F†—2çfÇVR#à¢Æ–çWB6Æ73Ò&f–VÆBÖ–çWB"7G–ÆSÒ'v–GFƒ£#‚"G—SÒ&çVÖ&W""Ö–ãÒ#"Æ6V†öÆFW#Ò%fÆ÷"4Å"fÇVSÒ"G·‚çfÆ÷'ÇÂrwÒ"öæ–çWCÒ"G·&VgÕ²G¶—ÕÒçfÆ÷#×'6T–çB‡F†—2çfÇVR—ÇÃ·6Æ5WFFR‚rG¶¶–æGÒr’#à¢Æ'WGFöâG—SÒ&'WGFöâ"6Æ73Ò&'FâÖÖ–æ’'FâÖÖ–æ’×&VB"öæ6Æ–6³Ò"G·&VgÒç7Æ–6R‚G¶—ÒÃ“·6Æ4W‡G&5&VæFW"‚rG¶¶–æGÒr“·6Æ5WFFR‚rG¶¶–æGÒr’#î)ÉSÂö'WGFöãà¢ÂöF—cæ’æ¦ö–â‚rr“°§Ğ ¢òò<:Æ7VÆòFR6÷7F÷2(	BFWgVVÇfR6÷7FòöæWFò÷"Væ–FB’FW6vÆ÷6P¦gVæ7F–öâ6Æ46ö×WFR†¶–æB—°¢6öç7BcÖ–CÓç'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B†–B“òçfÇVR—ÇÃ°¢–b†¶–æCÓÓÒvÇ7"r—°¢6öç7BG“ÔÖF‚æÖ‚ƒÇ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÇ7"×G’r“òçfÇVR—ÇÃ“°¢6öç7BFW7×b‚vÇ7"ÖFW7r’ó°¢6öç7BF&–f×b‚vÇ7"×F&–fr“°¢6öç7B6÷7FôÖCÔÖF‚ç&÷VæB‡b‚vÇ7"Ö&Vr’§b‚vÇ7"ÖÖBr’¢ƒ¶FW7’“°¢6öç7B6÷7FôÖÔÖF‚ç&÷VæB‚‡b‚vÇ7"×BÖ6÷'FRr’·b‚vÇ7"×BÖw&"r’’óc§F&–f“°¢6öç7B6÷7FôÖFóÔÖF‚ç&÷VæB‡b‚vÇ7"ÖÖFòr’óc¢‡F&–f£ãB’“°¢6öç7BW‡G&3ÕöÇ7$W‡G&2ç&VGV6R‚‡2Ç‚“Óç2²‡‚çfÆ÷'ÇÃ’Ã“°¢6öç7BÖ&vVãÔÖF‚æÖ–âƒ“ÄÖF‚æÖ‚ƒÇ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÇ7"ÖÖ&vVâr“òçfÇVR—ÇÃc’’ó°¢6öç7B6÷7FõVæ—CÖ6÷7FôÖB¶6÷7FôÖ¶6÷7FôÖFò¶W‡G&3°¢6öç7BæWFõVæ—CÔÖF‚ç&÷VæB†6÷7FõVæ—BòƒÖÖ&vVâ’“°¢&WGW&ç·G’ÆÖ&vVâÆ6÷7FõVæ—BÆæWFõVæ—BÆFW6vÆ÷6S¦ÖBBG¶6÷7FôÖBçFôÆö6ÆU7G&–ær‚vW2Ô4Âr—Ò+rÜ:BG¶6÷7FôÖçFôÆö6ÆU7G&–ær‚vW2Ô4Âr—Ò+rÔDòBG¶6÷7FôÖFòçFôÆö6ÆU7G&–ær‚vW2Ô4Âr—Ò+rW‡G&2BG¶W‡G&2çFôÆö6ÆU7G&–ær‚vW2Ô4Âr—Ò‡÷"Væ–FB–À¢FW63¢†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÇ7"ÖFW62r“òçfÇVWÇÂrr’çG&–Ò‚—ÇÂuG&&¦ò6÷'FRÌ:6W"wÓ°¢Ğ¢6öç7BG“ÔÖF‚æÖ‚ƒÇ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚væVò×G’r“òçfÇVR—ÇÃ“°¢6öç7B6öÆ÷&W3ÔÖF‚æÖ‚ƒÇ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚væVòÖ6öÆ÷&W2r“òçfÇVR—ÇÃ“°¢6öç7B6÷7FõGV&óÔÖF‚ç&÷VæB‡b‚væVòÖÆ&vòr’§b‚væVò×F—òr’¦6öÆ÷&W2“°¢6öç7B6÷÷'FS×b‚væVò×6÷÷'FRr’ÇG&ç3×b‚væVò×G&ç2r’ÆF–ÖÖW#×b‚væVòÖF–ÖÖW"r“°¢6öç7BW‡G&3ÕöæVôW‡G&2ç&VGV6R‚‡2Ç‚“Óç2²‡‚çfÆ÷'ÇÃ’Ã“°¢6öç7BÖ&vVãÔÖF‚æÖ–âƒ“ÄÖF‚æÖ‚ƒÇ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚væVòÖÖ&vVâr“òçfÇVR—ÇÃcR’’ó°¢6öç7B6÷7FõVæ—CÖ6÷7FõGV&ò·6÷÷'FR·G&ç2¶F–ÖÖW"¶W‡G&3°¢6öç7BæWFõVæ—CÔÖF‚ç&÷VæB†6÷7FõVæ—BòƒÖÖ&vVâ’“°¢&WGW&ç·G’ÆÖ&vVâÆ6÷7FõVæ—BÆæWFõVæ—BÆFW6vÆ÷6S¦GV&òBG¶6÷7FõGV&òçFôÆö6ÆU7G&–ær‚vW2Ô4Âr—Ò+r6÷BG·6÷÷'FRçFôÆö6ÆU7G&–ær‚vW2Ô4Âr—Ò+rG&fòBG·G&ç2çFôÆö6ÆU7G&–ær‚vW2Ô4Âr—Ò+r7G&ÂBG¶F–ÖÖW"çFôÆö6ÆU7G&–ær‚vW2Ô4Âr—Ò+rW‡G&2BG¶W‡G&2çFôÆö6ÆU7G&–ær‚vW2Ô4Âr—Ò‡÷"Væ–FB–À¢FW63¢†Fö7VÖVçBævWDVÆVÖVçD'”–B‚væVòÖFW62r“òçfÇVWÇÂrr’çG&–Ò‚—ÇÂtÆWG&W&òæ\;6âôÄTBwÓ°§Ğ ¦gVæ7F–öâ6Æ5WFFR†¶–æB—°¢6öç7BæVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B†¶–æB²rÖ–æÆ–æR×æVÂr“°¢–b‚æVÇÇÇæVÂç7G–ÆRæF—7Æ“ÓÓÒvæöæRr’&WGW&ã°¢6öç7B#×6Æ46ö×WFR†¶–æB“°¢6öç7BÆ&ÃÖFö7VÖVçBævWDVÆVÖVçD'”–B†¶–æB²rÖÖ&vVâÖÆ&Âr“¶–b†Æ&Â–Æ&ÂçFW‡D6öçFVçCÔÖF‚ç&÷VæB‡"æÖ&vVâ£’²rRs°¢6öç7BæWFõF÷FÃ×"ææWFõVæ—B§"çG“°¢6öç7BF÷FÄ—fÔÖF‚ç&÷VæB†æWFõF÷FÂ£ã’“°¢6öç7B3Ò†–BÇfÂ“Óç¶6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B†–B“¶–b†VÂ–VÂçFW‡D6öçFVçCÖf÷&ÖD4Å‡fÂ“·Ó°¢2†¶–æB²r×"Ö6÷7FòrÇ"æ6÷7FõVæ—B§"çG’“°¢2†¶–æB²r×"ÖæWFòrÆæWFõF÷FÂ“°¢2†¶–æB²r×"×F÷FÂrÇF÷FÄ—f“°¢2†¶–æB²r×"×–W¦rÇ"çG“ãôÖF‚ç&÷VæB‡F÷FÄ—f÷"çG’“£“°¢6öç7BFsÖFö7VÖVçBævWDVÆVÖVçD'”–B†¶–æB²rÖFW6vÆ÷6Rr“¶–b†Fr–FrçFW‡D6öçFVçC×"æFW6vÆ÷6S°§Ğ ¦gVæ7F–öâ6Æ4Ç’†¶–æB—°¢6öç7B#×6Æ46ö×WFR†¶–æB“°¢–b‡"æ6÷7FõVæ—CÃÓ—·Fö7B‚t–æw&W6Æ÷2FF÷2FVÂG&&¦ò&–ÖW&òrÂvW'&÷"r“·&WGW&ã·Ğ¢6Æ4–ç6W'E&÷r…÷6Æ5F&vWE¶¶–æEÒÇ¶FW63§"æFW62ÇVæC§"çG’Æ6÷7FõVæ—C§"æ6÷7FõVæ—BÇfVçFVæ—C§"ææWFõVæ—GÒ“°¢6Æ46ÆV"†¶–æB“°¢6öç7BæVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B†¶–æB²rÖ–æÆ–æR×æVÂr“¶–b‡æVÂ—æVÂæÚ±î¸Â¸­yêë¢°k¢G§¦*^