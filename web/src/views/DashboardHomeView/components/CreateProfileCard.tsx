import React, { useState } from "react";
import { Card, Elevation, InputGroup, Button, Intent, Tooltip, Position } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

const PROFILE_NAME_REGEX = /^[\p{L}\p{N}_ -]{1,30}$/u;

interface CreateProfileCardProps {
  newName: string;
  setNewName: (name: string) => void;
  onCreate: () => void;
  setShowCreate: (show: boolean) => void;
  error: string;
}

export const CreateProfileCard: React.FC<CreateProfileCardProps> = ({
  newName,
  setNewName,
  onCreate,
  setShowCreate,
  error,
}) => {
  const { t } = useTranslation();
  const [nameFocused, setNameFocused] = useState(false);

  const getErrorMessage = (err: string) => {
    if (!err) return "";
    if (err === "Profile limit exceeded (max 10)") {
      return t("common.profileLimitExceeded", "Profile limit exceeded (max 10)");
    }
    if (err === "The profile name already exists") {
      return t("common.profileNameExists", "The profile name already exists");
    }
    if (err === "Invalid Profile Name format") {
      return t("common.profileNameFormatError", "Invalid Profile Name format");
    }
    return err;
  };

  return (
    <Card
      elevation={Elevation.TWO}
      className="mb-6 p-4 dark:bg-gray-900 dark:border-gray-800 rounded-xl"
    >
      <div className="flex items-center gap-2">
        <Tooltip
          content={t("common.profileNameFormatTip", "Profile Name tip: 1-30 characters, duplicates not allowed")}
          isOpen={nameFocused}
          position={Position.TOP}
          intent={Intent.PRIMARY}
          className="flex-1"
        >
          <div className="w-full block">
            <InputGroup
              fill
              placeholder={t("common.newProfileName")}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onFocus={() => setNameFocused(true)}
              onBlur={() => setNameFocused(false)}
              autoFocus
            />
          </div>
        </Tooltip>
        <Button
          intent={Intent.SUCCESS}
          onClick={onCreate}
          text={t("common.create")}
          className="whitespace-nowrap"
          disabled={!PROFILE_NAME_REGEX.test(newName)}
        />
        <Button
          variant="minimal"
          onClick={() => setShowCreate(false)}
          icon="cross"
        />
      </div>
      {error && (
        <div className="mt-2 text-red-500 text-xs">
          {getErrorMessage(error)}
        </div>
      )}
    </Card>
  );
};
