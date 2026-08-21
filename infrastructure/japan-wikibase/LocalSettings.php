<?php

$wgSitename = getenv( 'JWB_SITE_NAME' ) ?: 'Japan Wikibase Development';
$wgMetaNamespace = 'Japan_Wikibase';
$wgScriptPath = '';
$wgArticlePath = '/wiki/$1';
$wgUsePathInfo = true;
$wgServer = getenv( 'JWB_PUBLIC_URL' ) ?: 'http://127.0.0.1:8180';
$wgResourceBasePath = $wgScriptPath;

$wgDBtype = 'mysql';
$wgDBserver = getenv( 'JWB_DB_HOST' );
$wgDBname = getenv( 'JWB_DB_NAME' );
$wgDBuser = getenv( 'JWB_DB_USER' );
$wgDBpassword = getenv( 'JWB_DB_PASSWORD' );
$wgDBprefix = '';
$wgDBTableOptions = 'ENGINE=InnoDB, DEFAULT CHARSET=binary';

$wgLanguageCode = 'ja';
$wgLocaltimezone = 'Asia/Tokyo';
$wgDefaultSkin = 'vector-2022';
$wgEnableEmail = false;
$wgEnableUserEmail = false;
$wgEmergencyContact = 'noreply@jwb.invalid';
$wgPasswordSender = 'noreply@jwb.invalid';

$wgSecretKey = getenv( 'JWB_SECRET_KEY' );
$wgUpgradeKey = getenv( 'JWB_UPGRADE_KEY' );
$wgAuthenticationTokenVersion = '1';
$wgRightsPage = '';
$wgRightsUrl = '';
$wgRightsText = '';
$wgRightsIcon = '';
$wgDiff3 = '/usr/bin/diff3';
$wgPingback = false;

$wgEnableUploads = true;
$wgUploadDirectory = '/var/www/html/images';
$wgUploadPath = '/images';
$wgFileExtensions = [ 'png', 'gif', 'jpg', 'jpeg', 'webp', 'svg' ];
$wgUseImageMagick = true;
$wgImageMagickConvertCommand = '/usr/bin/convert';

wfLoadSkin( 'Vector' );
wfLoadExtension( 'WikibaseRepository', "$IP/extensions/Wikibase/extension-repo.json" );
require_once "$IP/extensions/Wikibase/repo/ExampleSettings.php";

$wgEnableWikibaseRepo = true;
$wgWBRepoSettings['enableEntitySearchUI'] = true;
$wgWBRepoSettings['enableRefTabs'] = true;
$wgWBRepoSettings['siteLinkGroups'] = [];
$wgWBRepoSettings['formatterUrlProperty'] = null;

// REL1_43 requires explicit REST route registration.
$wgRestAPIAdditionalRouteFiles[] = "$IP/extensions/Wikibase/repo/rest-api/routes.json";

$wgGroupPermissions['*']['createaccount'] = false;
$wgGroupPermissions['*']['edit'] = false;
$wgGroupPermissions['user']['edit'] = true;
$wgGroupPermissions['user']['createpage'] = true;

$wgJobRunRate = 0;
$wgShowExceptionDetails = false;
$wgDebugToolbar = false;
