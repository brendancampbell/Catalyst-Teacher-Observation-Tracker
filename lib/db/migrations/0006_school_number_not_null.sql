-- Populate school_number for all schools then enforce NOT NULL

-- CP region
UPDATE schools SET school_number = '701' WHERE abbreviation = 'CP_MES';
UPDATE schools SET school_number = '702' WHERE abbreviation = 'CP_MMS';
UPDATE schools SET school_number = '703' WHERE abbreviation = 'CP_CES';
UPDATE schools SET school_number = '704' WHERE abbreviation = 'CP_CMS';
UPDATE schools SET school_number = '709' WHERE abbreviation = 'CP_HS';

-- NSA region
UPDATE schools SET school_number = '301' WHERE abbreviation = 'NSA_DTMS';
UPDATE schools SET school_number = '302' WHERE abbreviation = 'NSA_WPHS';
UPDATE schools SET school_number = '303' WHERE abbreviation = 'NSA_CHMS';
UPDATE schools SET school_number = '304' WHERE abbreviation = 'NSA_VES';
UPDATE schools SET school_number = '305' WHERE abbreviation = 'NSA_WPES';
UPDATE schools SET school_number = '306' WHERE abbreviation = 'NSA_VMS';
UPDATE schools SET school_number = '307' WHERE abbreviation = 'NSA_FES';
UPDATE schools SET school_number = '308' WHERE abbreviation = 'NSA_LES';
UPDATE schools SET school_number = '309' WHERE abbreviation = 'NSA_WMS';
UPDATE schools SET school_number = '310' WHERE abbreviation = 'NSA_AES';
UPDATE schools SET school_number = '311' WHERE abbreviation = 'NSA_CMS';
UPDATE schools SET school_number = '312' WHERE abbreviation = 'NSA_LPHS';
UPDATE schools SET school_number = '313' WHERE abbreviation = 'NSA_LPES';
UPDATE schools SET school_number = '314' WHERE abbreviation = 'NSA_LPMS';
UPDATE schools SET school_number = '315' WHERE abbreviation = 'NSA_IPES';

-- NYC region
UPDATE schools SET school_number = '101' WHERE abbreviation = 'NYC_UEBE';
UPDATE schools SET school_number = '102' WHERE abbreviation = 'NYC_UEGE';
UPDATE schools SET school_number = '103' WHERE abbreviation = 'NYC_UEBM';
UPDATE schools SET school_number = '104' WHERE abbreviation = 'NYC_UEGM';
UPDATE schools SET school_number = '201' WHERE abbreviation = 'NYC_UWMS';
UPDATE schools SET school_number = '202' WHERE abbreviation = 'NYC_UKMS';
UPDATE schools SET school_number = '203' WHERE abbreviation = 'NYC_UBEM';
UPDATE schools SET school_number = '205' WHERE abbreviation = 'NYC_UOHM';
UPDATE schools SET school_number = '207' WHERE abbreviation = 'NYC_UKES';
UPDATE schools SET school_number = '208' WHERE abbreviation = 'NYC_UCHE';
UPDATE schools SET school_number = '209' WHERE abbreviation = 'NYC_UWES';
UPDATE schools SET school_number = '401' WHERE abbreviation = 'NYC_UBWE';
UPDATE schools SET school_number = '402' WHERE abbreviation = 'NYC_UBSE';
UPDATE schools SET school_number = '403' WHERE abbreviation = 'NYC_UBNE';
UPDATE schools SET school_number = '404' WHERE abbreviation = 'NYC_UBNM';
UPDATE schools SET school_number = '405' WHERE abbreviation = 'NYC_UBWM';
UPDATE schools SET school_number = '406' WHERE abbreviation = 'NYC_UBSM';
UPDATE schools SET school_number = '407' WHERE abbreviation = 'NYC_UCES';
UPDATE schools SET school_number = '408' WHERE abbreviation = 'NYC_UCMS';
UPDATE schools SET school_number = '901' WHERE abbreviation = 'NYC_UCHS';
UPDATE schools SET school_number = '902' WHERE abbreviation = 'NYC_UCC';
UPDATE schools SET school_number = '903' WHERE abbreviation = 'NYC_UPC';
UPDATE schools SET school_number = '904' WHERE abbreviation = 'NYC_ULC';

-- RP region
UPDATE schools SET school_number = '501' WHERE abbreviation = 'RP_BCMS';
UPDATE schools SET school_number = '504' WHERE abbreviation = 'RP_JCES';
UPDATE schools SET school_number = '505' WHERE abbreviation = 'RP_CCMS';
UPDATE schools SET school_number = '506' WHERE abbreviation = 'RP_ACES';
UPDATE schools SET school_number = '507' WHERE abbreviation = 'RP_SJCES';
UPDATE schools SET school_number = '508' WHERE abbreviation = 'RP_SJCMS';
UPDATE schools SET school_number = '509' WHERE abbreviation = 'RP_HS';

-- RXP region
UPDATE schools SET school_number = '602' WHERE abbreviation = 'RXP_PS';
UPDATE schools SET school_number = '603' WHERE abbreviation = 'RXP_DC';
UPDATE schools SET school_number = '609' WHERE abbreviation = 'RXP_HS';

-- Home Office placeholder
UPDATE schools SET school_number = '000' WHERE abbreviation = 'HO';

-- Enforce NOT NULL now that every row has a value
ALTER TABLE schools ALTER COLUMN school_number SET NOT NULL;
