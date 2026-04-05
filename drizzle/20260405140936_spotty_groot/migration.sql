CREATE TABLE `tabs` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`cwd` text NOT NULL,
	`shell` text DEFAULT 'cmd.exe',
	`order` integer NOT NULL,
	`is_active` integer DEFAULT false
);
